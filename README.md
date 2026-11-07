# dev-diary-mcp

[![CI](https://github.com/rogeriolaa/dev-diary-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rogeriolaa/dev-diary-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-green)
![MCP](https://img.shields.io/badge/MCP-2026--07--28%20spec-8a2be2)

A **Model Context Protocol server** that turns a plain folder of Markdown files into a searchable work journal any LLM can read and write.

No database. No app. Your work log is just `diary/2026-11-07.md` — human-readable, diffable, git-friendly — and your AI assistant gets six tools to use it:

| Tool | What it does |
|---|---|
| `log_work` | Appends a timestamped entry (with tags) to today's file |
| `edit_entry` | Replaces an existing entry by date + time |
| `delete_entry` | Removes an existing entry by date + time |
| `search_diary` | Full-text search across all entries, optional tag/date filter |
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

## Correctness guarantees

Writes are the risky part of a file-backed store, so the server is careful about them:

- **Your hand-written content is never touched.** A day file may contain any Markdown you wrote by hand. The server never re-serializes a whole file from its parsed entries — it appends, and it splices edits into the original text. Content it doesn't understand survives untouched.
- **Concurrent calls can't lose entries.** All day-file mutations are serialized through an in-process queue, and each write goes to a temp file and is then renamed into place, so a reader never sees a half-written file.
- **Editing one entry doesn't affect its neighbours.** Entries are addressed by date, time, and occurrence, so two entries logged in the same minute stay individually editable and deletable.
- **Failed operations don't leave litter.** Deleting an entry that doesn't exist reports an error and creates no file; removing the last entry of a day removes the day file, so stats and streaks stay accurate.
- **`today` means your local day.** Dates default to the local timezone, not UTC, so an entry written at 22:00 lands on the right day.
- **Search can't flood your context.** `search_diary` accepts `from`/`to` date ranges and a `limit` (default 50).

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/ (tests excluded)
npm test            # unit tests (vitest)
npm run test:e2e    # end-to-end checks over a real MCP stdio session
npm run demo        # human-readable walkthrough
```

The end-to-end suite drives the server through a real MCP client and asserts on the resulting files — including that hand-written content survives every operation, that concurrent writes don't drop entries, and that error paths don't create stray files.

## How it works

Built with the official [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) SDK (2026-07-28 spec):

- `McpServer` + `registerTool(name, { description, inputSchema }, handler)` — schemas are Standard Schema; this project uses Zod v4
- `StdioServerTransport` — the editor spawns the process and talks JSON-RPC over stdin/stdout
- `src/storage.ts` holds the pure, side-effect-free parsing and editing logic; `src/server.ts` wires it to the MCP tools

Companion article: *"I Built an MCP Server That Keeps My Work Journal — Here's Everything I Learned"* (draft in this repo).

## License

MIT
