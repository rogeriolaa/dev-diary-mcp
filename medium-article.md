# I Built an MCP Server That Keeps My Work Journal — Here's Everything I Learned

*A Model Context Protocol server in ~190 lines of TypeScript that turns a folder of Markdown into a searchable work journal any AI assistant can read and write. Plus: how to demo an MCP server without an editor, and the things the tutorials don't tell you.*

---

Be honest: how long did your last "log what I did today" habit last? A week? Three days?

Here's the thing though — in 2026, *something else already knows what you did all day*: your AI assistant. It helped you debug the race condition, wrote half the tests with you, and sat through every refactor. The journal problem was never about discipline. It's about the log being a **separate place** from the work.

So I flipped it: instead of me feeding a journal, why not give my assistant tools to keep one?

The natural fit is **MCP (Model Context Protocol)** — the standard that lets LLM clients discover and call external tools. I built `dev-diary-mcp`: a server that turns a plain folder of Markdown files into a searchable work journal. It ended up being the best-sized project I've found for *learning* MCP, because it touches every core concept (tools, schemas, stdio transport, stateless storage) while staying under 200 lines.

- 💻 Code: [github.com/rogeriolaa/dev-diary-mcp](https://github.com/rogeriolaa/dev-diary-mcp)

## What it does

The assistant gets four tools:

| Tool | What it does |
|---|---|
| `log_work` | Appends a timestamped entry (with tags) to today's file |
| `search_diary` | Full-text search across all entries |
| `daily_summary` | Everything logged on a given date |
| `stats` | Totals, streaks, top tags |

The storage format is deliberately boring. One file per day:

```markdown
## 14:32 #bugfix #websocket
Fixed the race condition in the WebSocket broadcast queue

## 16:10 #testing
Wrote E2E test covering two-client sync
```

That's it. No database. You can grep it, commit it, edit it by hand. This choice mattered more than I expected — more on that later.

## How to build one (the whole recipe)

### 1. The skeleton is genuinely small

With the official TypeScript SDK (v2, implementing the 2026-07-28 spec):

```bash
npm install @modelcontextprotocol/server zod
```

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'dev-diary', version: '1.0.0' });

server.registerTool(
  'log_work',
  {
    description: 'Append a timestamped entry to the developer diary...',
    inputSchema: z.object({
      text: z.string().min(1),
      tags: z.array(z.string()).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },
  async ({ text, tags = [], date }) => {
    // ...append to diary/YYYY-MM-DD.md...
    return { content: [{ type: 'text', text: 'Logged.' }] };
  },
);

await server.connect(new StdioServerTransport());
```

That's a complete MCP server. Four concepts carry everything:

1. **`registerTool(name, config, handler)`** — the tool catalog
2. **`inputSchema`** — a Zod schema; the SDK turns it into JSON Schema for the client, and validates arguments for you before your handler ever runs
3. **Return value** — `{ content: [{ type: 'text', text: '...' }] }`; this is what the LLM reads as the tool's result
4. **Transport** — `StdioServerTransport()` means the client spawns your process and speaks JSON-RPC over stdin/stdout. No ports, no auth for local use

### 2. Descriptions are prompts, not documentation

This is the biggest mental shift. Your tool descriptions aren't API docs for humans — they're **instructions the LLM reads to decide when and how to call your tool**. Compare:

```typescript
// ❌ documentation-style
description: 'Appends an entry to the diary.'

// ✅ prompt-style
description: 'Append a timestamped entry to the developer diary for today.
Use this whenever the user says they finished/did/fixed something and
wants it recorded.'
```

The second one tells the model *when to reach for the tool*. That "use this whenever..." clause is doing real work — it converts user intent ("I finally fixed that flaky test") into a tool call without any explicit command.

Same for parameter descriptions: `tags: 'Optional labels, e.g. ["bugfix","api"]'` teaches the model the expected shape by example.

### 3. Design tools around questions, not tables

My first draft had CRUD tools (`add_entry`, `update_entry`, `delete_entry`). Wrong shape. Nobody asks their journal to "update entry 47" — they ask *"what did I do about the WebSocket bug last week?"*

So the final set maps to intents: `search_diary` (find things), `daily_summary` (recap a day), `stats` (the motivation view), and exactly one writer, `log_work`. Four tools, zero overlap, each answering a question a developer actually asks.

Rule of thumb I landed on: **one tool per user question, not one per data operation.**

## The demo problem (and its elegant solution)

Here's what almost killed the project: **how do you demonstrate an MCP server?**

The honest answer is "connect Claude Desktop to it and screenshot a chat" — which proves nothing reproducible, depends on a closed app, and can't run in CI or on a reader's machine.

Then I remembered the boring superpower of the spec: **MCP is just client/server over stdio**. Nothing stops me from writing a second, tiny program that connects to my server like any editor would and drives it end-to-end:

```typescript
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js'],   // spawns the server as a child process
});
const client = new Client({ name: 'demo-client', version: '1.0.0' });
await client.connect(transport);

// Exactly what Claude Desktop does under the hood:
const { tools } = await client.listTools();
await client.callTool({ name: 'log_work', arguments: {
  text: 'Fixed the race condition in the broadcast queue',
  tags: ['bugfix', 'websocket'],
}});
```

Fifty lines later, `npm run demo` produces this — a full protocol session as proof:

```
=== 1. listTools ===
 • log_work — Append a timestamped entry to the developer diary...
 • search_diary — Full-text search across every entry...
 • daily_summary — Everything logged on a given date...
 • stats — Totals, active days, streaks, top tags...

=== 2. log_work x3 ===
Logged to 2026-08-22.md at 19:05 (tags: bugfix, websocket)
...

=== 5. stats ===
📊 1 entries across 2 day(s)
🔥 Streak: 2 consecutive day(s)
🏷️ Top tags: #bugfix (1), #websocket (1)
```

And because it's a script, it's also my **integration test**. Every change to the server, I run the demo; if the handshake breaks or a schema drifts, it fails loudly. Demo, docs, and test suite in one artifact.

If you want a visual route instead, the official Inspector (`npx @modelcontextprotocol/inspector node dist/server.js`) gives you a web UI to poke tools by hand. Both together cover development and demonstration nicely.

## Things the tutorials don't tell you

**Top-level await will betray you.** The SDK README shows `await server.connect(...)` at module top level — fine if your package is ESM (`"type": "module"`), a hard error if TypeScript compiles you to CommonJS. Wrapping startup in `main()` costs nothing and works everywhere.

**`exactOptionalPropertyTypes` fights optional schemas.** With strict TS, passing `tags: undefined` into an `z.string().optional()` field errors. Either relax the flag or normalize args at the handler boundary. Cost me ten confused minutes.

**Descriptions are loaded into context.** Every tool description ships to the model on every conversation where the server is connected. Verbose marketing copy wastes tokens and dilutes the useful instructions. Short, imperative, intent-focused wins.

**Stateless servers are a feature.** My server holds no state — it re-reads whatever Markdown is on disk at every call. Consequence: I can hand-edit files between calls and never see stale data, and two clients pointed at the same folder share the truth for free. Resist putting caches in front of file-based tools until profiling says otherwise.

**Timezones are a trap even in a toy.** `new Date().toISOString().slice(11,16)` gives UTC — fine until someone in UTC-3 logs at 6 PM and sees "21:05". One line fixes it, but only after you notice.

## Connecting it for real

In Claude Desktop / Cursor / any MCP-capable client (`claude_desktop_config.json` style):

```json
{
  "mcpServers": {
    "dev-diary": {
      "command": "node",
      "args": ["/absolute/path/to/dev-diary-mcp/dist/server.js"],
      "env": { "DIARY_DIR": "/home/you/journal" }
    }
  }
}
```

Point `DIARY_DIR` at a folder inside your dotfiles repo and your work journal versions itself as a side effect. After a week of use, ask your assistant: *"summarize my week from the diary, group by tag"* — and get back a status report nobody had to write.

## Why Markdown-as-database won

I want to defend the most opinionated choice. Alternatives were SQLite (better queries, opaque storage) or JSON (parseable, ugly diffs). Plain Markdown files won because:

1. **The human is a first-class client.** I read my journal in editors, greps, and git logs — no tool required.
2. **Git becomes free backup + history.** `git log diary/` is an audit trail no database gives you by default.
3. **LLMs are phenomenal at Markdown.** No serialization mismatch between what the model writes and what's stored.
4. **Failure mode is graceful.** A corrupted line is visible and fixable by hand; a corrupted SQLite page isn't.

The lesson generalizes beyond journals: **when both humans and LLMs are clients of your data, store it in the format both already speak.**

## Try it

```bash
git clone https://github.com/rogeriolaa/dev-diary-mcp
cd dev-diary-mcp && npm install && npm run build && npm run demo
```

Then wire it into your editor's MCP config and let your assistant start logging. The whole thing — server, demo client, README — is ~400 lines including configuration.

Building small MCP servers like this is, I think, the highest-leverage way to learn the protocol: you touch every concept, you ship something you'll actually use daily, and the surface area is small enough to understand completely.

What would *your* five-line-a-day automation be? An MCP server for your reading list? Your gym log? Your standup notes? Tell me in the comments — and if you build one, link it. 🚀

---

*Tags: MCP · TypeScript · AI Tools · Node.js · Developer Productivity*
