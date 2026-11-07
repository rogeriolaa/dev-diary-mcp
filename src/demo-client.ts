/**
 * Demo client — connects to dev-diary over stdio and drives it like a
 * real LLM assistant would: log entries, search, summarize, stats.
 *
 * This doubles as PROOF that the server works: a real MCP client,
 * real protocol handshake, real tool calls.
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js'],
});
const client = new Client({ name: 'demo-client', version: '1.0.0' });
await client.connect(transport);

const text = (r: any) => r.content.map((c: any) => c.text).join('\n');

// Compute yesterday in YYYY-MM-DD (local timezone)
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// 1. What tools does the server expose?
console.log('=== 1. listTools ===');
for (const t of (await client.listTools()).tools) {
  console.log(` • ${t.name} — ${t.description?.split('\n')[0]}`);
}

// 2. Log some work, like an assistant would when the user says "log this"
console.log('\n=== 2. log_work x3 ===');
console.log(text(await client.callTool({
  name: 'log_work',
  arguments: { text: 'Fixed the race condition in the WebSocket broadcast queue', tags: ['bugfix', 'websocket'] },
})));
console.log(text(await client.callTool({
  name: 'log_work',
  arguments: { text: 'Wrote E2E test covering two-client sync', tags: ['testing'] },
})));
console.log(text(await client.callTool({
  name: 'log_work',
  arguments: {
    date: yesterday,
    time: '12:00',
    text: 'Researched MCP spec 2026-07-28 changes',
    tags: ['research'],
  },
})));

// 3. Search across everything
console.log('\n=== 3. search_diary("websocket") ===');
console.log(text(await client.callTool({ name: 'search_diary', arguments: { query: 'websocket' } })));

// 4. Yesterday at a glance
console.log(`\n=== 4. daily_summary(${yesterday}) ===`);
console.log(text(await client.callTool({ name: 'daily_summary', arguments: { date: yesterday } })));

// 5. Edit an existing entry
console.log('\n=== 5. edit_entry (yesterday, first entry) ===');
console.log(text(await client.callTool({
  name: 'edit_entry',
  arguments: { date: yesterday, time: '12:00', text: 'Researched the MCP spec and wrote it up', occurrence: 1 },
})));

// 6. Delete an entry that doesn't exist — should report an error, not succeed
console.log('\n=== 6. delete_entry (nonexistent — expect an error) ===');
console.log(text(await client.callTool({
  name: 'delete_entry',
  arguments: { date: yesterday, time: '03:03' },
})));

// 7. Stats + streak
console.log('\n=== 7. stats ===');
console.log(text(await client.callTool({ name: 'stats', arguments: {} })));

await client.close();
console.log('\n✅ demo complete — check ./diary/*.md for the raw files');
