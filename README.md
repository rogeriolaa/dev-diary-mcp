# dev-diary-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A518-green)
![MCP](https://img.shields.io/badge/MCP-2026--07--28%20spec-8a2be2)

A **Model Context Protocol server** that turns a plain folder of Markdown files into a searchable work journal any LLM can read and write.

No database. No app. Your work log is just `diary/2026-08-22.md` — human-readable, diffable, git-friendly — and your AI assistant gets four tools to use it:

| Tool | What it does |
|---|---|
| `log_work` | Appends a timestamped entry (with tags) to today's file |
| `search_diary` | Full-text search across all entries, optional tag filter |
| `daily_summary` | Everything logged on a given day |
| `stats` | Totals, active days, current streak, top tags |

## Why

"Log what I did today" is the task everyone abandons after a week. But your AI assistant already knows what you did — it helped you do it. Give it tools against a Markdown folder and keeping a work journal becomes a byproduct of working with AI.

## Run the demo

The repo ships a real MCP **client** that drives the server end-to-end (handshake → listTools → tool calls), so you can verify everything without an editor:

```bash
npm install
npm run build
npm run demo
```

Output:

```
=== 1. listTools ===
 • log_work — Append a timestamped entry...
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

Then look at `diary/*.md` — that's your data. Plain Markdown.

## Connect it to your editor / agent

### Claude Desktop / Cursor / any MCP client

```json
{
  "mcpServers": {
    "dev-diary": {
      "command": "node",
      "args": ["/absolute/path/to/dev-diary-mcp/dist/server.js"],
      "env": { "DIARY_DIR": "/absolute/path/to/your/diary" }
    }
  }
}
```

### Hermes Agent

```bash
hermes mcp add dev-diary --command node --args /path/to/dist/server.js
```

### Inspect it interactively

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

## The storage format

One file per day (`diary/YYYY-MM-DD.md`), entries as H2 headings with embedded tags:

```markdown
## 14:32 #bugfix #websocket
Fixed the race condition in the WebSocket broadcast queue

## 16:10 #testing
Wrote E2E test covering two-client sync
```

Because it's just files, you can grep it, back it up, edit it by hand, or commit it. The server reads whatever is on disk on every call — no cache to invalidate.

## How it works (~190 lines of TypeScript)

Built with the official [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) SDK (2026-07-28 spec):

- `McpServer` + `registerTool(name, { description, inputSchema }, handler)` — schemas are Standard Schema; this project uses Zod v4
- `StdioServerTransport` — the editor spawns the process and talks JSON-RPC over stdin/stdout
- Tool handlers read/write Markdown under `DIARY_DIR` (default: `./diary`)

Companion article: *"I Built an MCP Server That Keeps My Work Journal — Here's Everything I Learned"* (draft in this repo).

## License

MIT
