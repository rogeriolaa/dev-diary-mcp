/**
 * dev-diary-mcp — an MCP server that turns a plain folder of Markdown
 * files into a searchable work journal any LLM can read and write.
 *
 * Tools:
 *   log_work      — append a timestamped entry (optionally tagged)
 *   search_diary  — full-text search across all entries
 *   daily_summary — what happened on a given day
 *   stats         — entries per day/tag, streaks
 *
 * Storage: ./diary/*.md — human-readable, git-friendly, no database.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIARY_DIR = process.env.DIARY_DIR ?? path.join(process.cwd(), 'diary');

// ---------------------------------------------------------------- storage
function fileFor(date: string) {
  return path.join(DIARY_DIR, `${date}.md`); // one file per day: 2026-08-22.md
}

async function ensureDir() {
  await fs.mkdir(DIARY_DIR, { recursive: true });
}

/** Parse one day file into structured entries: [{time, tags, text}] */
function parseEntries(md: string) {
  const out: { time: string; tags: string[]; text: string }[] = [];
  for (const m of md.matchAll(/^## (\d{2}:\d{2})([^\n]*)\n([\s\S]*?)(?=^## \d{2}:\d{2}|\z)/gm)) {
    const tags = [...m[2].matchAll(/#([\w-]+)/g)].map((t) => t[1]);
    out.push({ time: m[1], tags, text: m[3].trim() });
  }
  return out;
}

async function readDay(date: string) {
  try {
    return parseEntries(await fs.readFile(fileFor(date), 'utf8'));
  } catch {
    return [];
  }
}

async function listDays() {
  await ensureDir();
  const files = await fs.readdir(DIARY_DIR);
  return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().map((f) => f.replace('.md', ''));
}

// ---------------------------------------------------------------- server
const server = new McpServer({ name: 'dev-diary', version: '1.0.0' });

server.registerTool(
  'log_work',
  {
    description:
      'Append a timestamped entry to the developer diary for today (or a given date). Use this whenever the user says they finished/did/fixed something and wants it recorded.',
    inputSchema: z.object({
      text: z.string().min(1).describe('What was done, in free prose'),
      tags: z.array(z.string()).optional().describe('Optional labels, e.g. ["bugfix","api"]'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('ISO date; defaults to today'),
    }),
  },
  async ({ text, tags = [], date }) => {
    await ensureDir();
    const now = new Date();
    const day = date ?? now.toISOString().slice(0, 10);
    // local-ish time without dragging in tz deps
    const time = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(11, 16);

    const tagSuffix = tags.length ? ' ' + tags.map((t) => '#' + t.replace(/\s/g, '-')).join(' ') : '';
    let line = `## ${time}${tagSuffix}\n${text}\n`;

    const file = fileFor(day);
    let existing = '';
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      /* new day */
    }
    await fs.writeFile(file, existing + line);

    return {
      content: [{ type: 'text', text: `Logged to ${day}.md at ${time}${tags.length ? ` (tags: ${tags.join(', ')})` : ''}` }],
    };
  },
);

server.registerTool(
  'search_diary',
  {
    description: 'Full-text search across every diary entry. Returns matching entries with their date, time and tags.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Text to look for (case-insensitive)'),
      tag: z.string().optional().describe('Restrict to entries with this tag'),
    }),
  },
  async ({ query, tag }) => {
    const days = await listDays();
    const hits = [];
    const needle = query.toLowerCase();

    for (const day of days) {
      for (const e of await readDay(day)) {
        if (tag && !e.tags.includes(tag)) continue;
        if (e.text.toLowerCase().includes(needle) || e.tags.some((t) => t.includes(needle))) {
          hits.push(`${day} ${e.time}${e.tags.length ? ' [' + e.tags.join(',') + ']' : ''}\n  ${e.text}`);
        }
      }
    }
    return {
      content: [{
        type: 'text',
        text: hits.length ? `${hits.length} match(es):\n\n${hits.join('\n\n')}` : `No matches for "${query}".`,
      }],
    };
  },
);

server.registerTool(
  'daily_summary',
  {
    description: "Everything logged on a given date (YYYY-MM-DD). Defaults to today.",
    inputSchema: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },
  async ({ date }) => {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const entries = await readDay(day);
    if (!entries.length) return { content: [{ type: 'text', text: `Nothing logged on ${day}.` }] };

    const body = entries.map((e) => `${e.time}${e.tags.length ? ' ' + e.tags.map((t) => '#' + t).join(' ') : ''}\n${e.text}`).join('\n\n');
    return { content: [{ type: 'text', text: `📋 ${day} — ${entries.length} entr(y|ies)\n\n${body}` }] };
  },
);

server.registerTool(
  'stats',
  {
    description: 'Diary statistics: total entries, active days, current streak of consecutive days, and top tags.',
    inputSchema: z.object({}),
  },
  async () => {
    const days = await listDays();
    let total = 0;
    const tagCount = new Map();
    for (const d of days) {
      const entries = await readDay(d);
      total += entries.length;
      for (const e of entries) for (const t of e.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }

    // consecutive-day streak ending at the most recent logged day
    const set = new Set(days);
    let cursor = days.at(-1);
    let streak = 0;
    while (cursor && set.has(cursor)) {
      streak++;
      const dt = new Date(cursor + 'T12:00:00Z');
      dt.setUTCDate(dt.getUTCDate() - 1);
      cursor = dt.toISOString().slice(0, 10);
    }

    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([t, n]) => `#${t} (${n})`).join(', ');

    return {
      content: [{
        type: 'text',
        text: `📊 ${total} entries across ${days.length} day(s)\n🔥 Streak: ${streak} consecutive day(s)\n🏷️ Top tags: ${topTags || 'none yet'}`,
      }],
    };
  },
);

// ---------------------------------------------------------------- go
async function main() {
  await server.connect(new StdioServerTransport());
}
main();
