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
    date: '2026-08-21',
    text: 'Researched MCP spec 2026-07-28 changes',
    tags: ['research'],
  },
})));

// 3. Search across everything
console.log('\n=== 3. search_diary("websocket") ===');
console.log(text(await client.callTool({ name: 'search_diary', arguments: { query: 'websocket' } })));

// 4. Yesterday at a glance
console.log('\n=== 4. daily_summary(2026-08-21) ===');
console.log(text(await client.callTool({ name: 'daily_summary', arguments: { date: '2026-08-21' } })));

// 5. Stats + streak
console.log('\n=== 5. stats ===');
console.log(text(await client.callTool({ name: 'stats', arguments: {} })));

await client.close();
console.log('\n✅ demo complete — check ./diary/*.md for the raw files');
