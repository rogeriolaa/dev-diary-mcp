/**
 * End-to-end verification against a real MCP client over stdio.
 * Writes a diary file with hand-written content, then exercises every tool
 * and verifies the hand-written content survives.
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = process.env.TEST_DIARY_DIR!;
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js'],
  env: { ...process.env, DIARY_DIR: DIR },
});
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);

const text = (r: any) => r.content.map((c: any) => c.text).join('\n');
const call = (name: string, args: any = {}) => client.callTool({ name, arguments: args });

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const DAY = '2026-03-15';
const file = path.join(DIR, `${DAY}.md`);

await fs.rm(DIR, { recursive: true, force: true });
await fs.mkdir(DIR, { recursive: true });

// Seed a file with hand-written content the server must not touch.
await fs.writeFile(
  file,
  `# My Diary — ${DAY}\n\nA free-form note I wrote by hand.\n\n## 08:00 #standup\nMorning notes\n`,
  'utf8',
);

// 1. log_work must preserve hand-written content
await call('log_work', { date: DAY, time: '09:00', text: 'Shipped the fix', tags: ['bugfix'] });
let raw = await fs.readFile(file, 'utf8');
check('hand-written header survives log_work', raw.includes('# My Diary — 2026-03-15'));
check('hand-written note survives log_work', raw.includes('A free-form note I wrote by hand.'));
check('original entry survives log_work', raw.includes('Morning notes'));
check('new entry was added', raw.includes('Shipped the fix'));

// 2. edit_entry must preserve hand-written content
await call('edit_entry', { date: DAY, time: '09:00', text: 'Shipped the hotfix', tags: ['bugfix'] });
raw = await fs.readFile(file, 'utf8');
check('hand-written content survives edit_entry', raw.includes('A free-form note I wrote by hand.'));
check('edit applied', raw.includes('Shipped the hotfix') && !raw.includes('Shipped the fix\n'));

// 3. two entries with the same time: delete must remove only one
await call('log_work', { date: DAY, time: '09:00', text: 'Second entry same minute', tags: ['other'] });
raw = await fs.readFile(file, 'utf8');
const summary = text(await call('daily_summary', { date: DAY }));
check('both same-time entries present', (summary.match(/09:00/g) ?? []).length === 2, summary.replace(/\n/g, ' | '));

await call('delete_entry', { date: DAY, time: '09:00', occurrence: 1 });
raw = await fs.readFile(file, 'utf8');
const after = text(await call('daily_summary', { date: DAY }));
check('delete removed exactly one same-time entry', (after.match(/09:00/g) ?? []).length === 1);
check('the other same-time entry survived', after.includes('Second entry same minute'));
check('hand-written content survives delete_entry', raw.includes('A free-form note I wrote by hand.'));

// 4. deleting a non-existent entry must report an error, not success
const missing = await call('delete_entry', { date: DAY, time: '03:03' });
check('deleting a missing entry reports an error', missing.isError === true, text(missing));

// 5. deleting a non-existent DATE must not create a phantom day file
await call('delete_entry', { date: '2020-01-01', time: '10:00' });
const files = await fs.readdir(DIR);
check('no phantom day file created', !files.includes('2020-01-01.md'), files.join(', '));

// 6. edit_entry without tags keeps the existing tags
await call('log_work', { date: DAY, time: '14:00', text: 'tagged entry', tags: ['keepme', 'other'] });
await call('edit_entry', { date: DAY, time: '14:00', text: 'tagged entry edited' });
const t = text(await call('daily_summary', { date: DAY }));
check('edit without tags preserves tags', t.includes('#keepme'), t.replace(/\n/g, ' | '));

// 7. tags with whitespace are sanitized
await call('log_work', { date: DAY, time: '15:00', text: 'spaced tag', tags: ['my tag'] });
raw = await fs.readFile(file, 'utf8');
check('tag whitespace sanitized to dash', raw.includes('#my-tag') && !raw.includes('#my tag'));
check('tag roundtrips', text(await call('daily_summary', { date: DAY })).includes('#my-tag'));

// 8. search date range + limit
await call('log_work', { date: '2026-03-20', time: '09:00', text: 'later entry', tags: ['range'] });
const ranged = text(await call('search_diary', { query: 'entry', from: DAY, to: DAY }));
check('search from/to filters out other days', !ranged.includes('2026-03-20'), ranged.replace(/\n/g, ' | '));

const limited = text(await call('search_diary', { query: 'e', limit: 1 }));
check('search respects limit', limited.startsWith('1 match(es)'), limited.split('\n')[0]);

// 9. concurrent log_work calls must not lose entries
const CONCURRENT = 12;
await Promise.all(
  Array.from({ length: CONCURRENT }, (_, i) =>
    call('log_work', { date: '2026-04-01', time: '10:00', text: `concurrent ${i}`, tags: ['conc'] }),
  ),
);
const conc = text(await call('daily_summary', { date: '2026-04-01' }));
const concCount = (conc.match(/concurrent \d+/g) ?? []).length;
check(`all ${CONCURRENT} concurrent writes survived`, concCount === CONCURRENT, `got ${concCount}`);

// 10. stats counts correctly — derive the expected total from the files
const dayFiles = (await fs.readdir(DIR)).filter((f) => f.endsWith('.md'));
let expectedTotal = 0;
for (const df of dayFiles) {
  const dayName = df.replace('.md', '');
  const summaryText = text(await call('daily_summary', { date: dayName }));
  expectedTotal += Number(summaryText.match(/— (\d+) entr/)?.[1] ?? 0);
}
const stats = text(await call('stats', {}));
const total = Number(stats.match(/📊 (\d+) entries/)?.[1] ?? 0);
check('stats total matches actual entries', total === expectedTotal, `stats=${total} expected=${expectedTotal}`);

// 11. hand-edited file with an entry lacking a trailing newline still parses
await fs.writeFile(path.join(DIR, '2026-05-05.md'), '## 07:00 #note\nno trailing newline', 'utf8');
const nt = text(await call('daily_summary', { date: '2026-05-05' }));
check('parses entry without trailing newline', nt.includes('no trailing newline'), nt.replace(/\n/g, ' | '));

await client.close();
console.log(failures === 0 ? '\n✅ ALL E2E CHECKS PASSED' : `\n❌ ${failures} E2E CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
