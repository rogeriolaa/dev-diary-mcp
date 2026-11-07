#!/usr/bin/env node
/**
 * dev-diary-mcp — an MCP server that turns a plain folder of Markdown
 * files into a searchable work journal any LLM can read and write.
 *
 * Tools:
 *   log_work      — append a timestamped entry (optionally tagged)
 *   search_diary  — full-text search across all entries, optional tag/date filter
 *   edit_entry    — replace an existing entry by date + time (+ occurrence)
 *   delete_entry  — remove an existing entry by date + time (+ occurrence)
 *   daily_summary — what happened on a given day
 *   stats         — entries per day/tag, streaks, top tags
 *
 * Storage: ./diary/*.md — human-readable, git-friendly, no database.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  appendEntry,
  findByTime,
  inRange,
  parseEntries,
  removeEntry,
  replaceEntry,
  sanitizeTags,
  todayLocal,
} from './storage.js';

const DIARY_DIR = process.env.DIARY_DIR ?? path.join(process.cwd(), 'diary');

// ---------------------------------------------------------------- storage
function fileFor(date: string) {
  return path.join(DIARY_DIR, `${date}.md`); // one file per day: 2026-08-22.md
}

async function ensureDir() {
  await fs.mkdir(DIARY_DIR, { recursive: true });
}

// Write mutex: serializes all day-file mutations to prevent lost updates
// when multiple MCP tool calls arrive concurrently over stdio.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(() => fn());
  writeQueue = result.catch(() => {}); // swallow rejection so the chain never breaks
  return result;
}

/** Read a day file's raw Markdown (empty string if it doesn't exist). */
async function readRaw(date: string): Promise<string> {
  try {
    return await fs.readFile(fileFor(date), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Apply `mutate` to a day file's raw Markdown and write it back atomically.
 * If the mutation produced no change the file is left alone; if it produced
 * an empty file the file is removed — so a failed edit can't leave a phantom
 * empty day behind that would skew stats and streaks.
 */
async function mutateDayFile(
  date: string,
  mutate: (raw: string) => { raw: string; changed: boolean },
): Promise<boolean> {
  await ensureDir();
  const file = fileFor(date);
  const existing = await readRaw(date);
  const { raw, changed } = mutate(existing);

  if (!changed) return false;

  if (!raw.trim()) {
    await fs.rm(file, { force: true });
    return true;
  }

  const tmp = file + `.${process.pid}.tmp`;
  await fs.writeFile(tmp, raw, { mode: 0o644 });
  await fs.rename(tmp, file);
  return true;
}

async function readDay(date: string) {
  return parseEntries(await readRaw(date));
}

async function listDays() {
  await ensureDir();
  const files = await fs.readdir(DIARY_DIR);
  return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().map((f) => f.replace('.md', ''));
}

// ---------------------------------------------------------------- server
const server = new McpServer({ name: 'dev-diary', version: '1.1.0' });

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeArg = z.string().regex(/^\d{2}:\d{2}$/);

server.registerTool(
  'log_work',
  {
    description:
      'Append a timestamped entry to the developer diary for today (or a given date). Use this whenever the user says they finished/did/fixed something and wants it recorded.',
    inputSchema: z.object({
      text: z.string().min(1).describe('What was done, in free prose'),
      tags: z.array(z.string()).optional().describe('Optional labels, e.g. ["bugfix","api"]'),
      date: dateArg.optional().describe('ISO date; defaults to today in local timezone'),
      time: timeArg.optional().describe('Time of the entry (HH:MM); defaults to now'),
    }),
  },
  async ({ text, tags = [], date, time: timeArg }) => {
    const day = date ?? todayLocal();
    const now = new Date();
    const time =
      timeArg ??
      new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(11, 16);
    const cleanTags = sanitizeTags(tags);

    return enqueueWrite(async () => {
      await mutateDayFile(day, (raw) => ({
        raw: appendEntry(raw, { time, tags: cleanTags, text }),
        changed: true,
      }));
      return {
        content: [
          {
            type: 'text',
            text: `Logged to ${day}.md at ${time}${cleanTags.length ? ` (tags: ${cleanTags.join(', ')})` : ''}`,
          },
        ],
      };
    });
  },
);

server.registerTool(
  'edit_entry',
  {
    description:
      'Replace an existing entry identified by date and time (HH:MM). If several entries share the same time, use `occurrence` to pick one (1-based). Omit `tags` to keep the existing tags.',
    inputSchema: z.object({
      date: dateArg.describe('ISO date of the entry'),
      time: timeArg.describe('Time of the entry (HH:MM)'),
      text: z.string().min(1).describe('New entry text'),
      tags: z.array(z.string()).optional().describe('New labels; omit to keep existing tags'),
      occurrence: z.number().int().min(1).optional().describe('Which entry with that time (1-based)'),
    }),
  },
  async ({ date, time, text, tags, occurrence = 1 }) => {
    return enqueueWrite(async () => {
      let found = false;
      await mutateDayFile(date, (raw) => {
        const idx = findByTime(raw, time, occurrence);
        if (idx === -1) return { raw, changed: false };
        found = true;
        const current = parseEntries(raw)[idx];
        return {
          raw: replaceEntry(raw, idx, {
            time,
            tags: tags === undefined ? current.tags : sanitizeTags(tags),
            text,
          }),
          changed: true,
        };
      });
      if (!found) {
        return {
          content: [{ type: 'text', text: `No entry found on ${date} at ${time} (occurrence ${occurrence}).` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `Edited entry on ${date} at ${time}.` }] };
    });
  },
);

server.registerTool(
  'delete_entry',
  {
    description:
      'Remove an existing entry identified by date and time (HH:MM). If several entries share the same time, use `occurrence` to pick one (1-based).',
    inputSchema: z.object({
      date: dateArg.describe('ISO date of the entry'),
      time: timeArg.describe('Time of the entry (HH:MM)'),
      occurrence: z.number().int().min(1).optional().describe('Which entry with that time (1-based)'),
    }),
  },
  async ({ date, time, occurrence = 1 }) => {
    return enqueueWrite(async () => {
      let found = false;
      await mutateDayFile(date, (raw) => {
        const idx = findByTime(raw, time, occurrence);
        if (idx === -1) return { raw, changed: false };
        found = true;
        return { raw: removeEntry(raw, idx), changed: true };
      });
      if (!found) {
        return {
          content: [{ type: 'text', text: `No entry found on ${date} at ${time} (occurrence ${occurrence}).` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `Deleted entry on ${date} at ${time}.` }] };
    });
  },
);

server.registerTool(
  'search_diary',
  {
    description: 'Full-text search across every diary entry. Returns matching entries with date, time and tags.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Text to look for (case-insensitive)'),
      tag: z.string().optional().describe('Restrict to entries with this tag'),
      from: dateArg.optional().describe('Start date (inclusive)'),
      to: dateArg.optional().describe('End date (inclusive)'),
      limit: z.number().min(1).max(1000).optional().default(50).describe('Max results to return'),
    }),
  },
  async ({ query, tag, from, to, limit }) => {
    const days = await listDays();
    const hits: string[] = [];
    const needle = query.toLowerCase();

    for (const day of days) {
      if (!inRange(day, from, to)) continue;
      for (const e of await readDay(day)) {
        if (tag && !e.tags.includes(tag)) continue;
        if (e.text.toLowerCase().includes(needle) || e.tags.some((t) => t.includes(needle))) {
          hits.push(`${day} ${e.time}${e.tags.length ? ' [' + e.tags.join(',') + ']' : ''}\n  ${e.text}`);
          if (hits.length >= limit) break;
        }
      }
      if (hits.length >= limit) break;
    }

    return {
      content: [{
        type: 'text',
        text: hits.length
          ? `${hits.length} match(es)${hits.length === limit ? ` (showing first ${limit})` : ''}\n\n${hits.join('\n\n')}`
          : `No matches for "${query}".`,
      }],
    };
  },
);

server.registerTool(
  'daily_summary',
  {
    description: "Everything logged on a given date (YYYY-MM-DD). Defaults to today.",
    inputSchema: z.object({
      date: dateArg.optional(),
    }),
  },
  async ({ date }) => {
    const day = date ?? todayLocal();
    const entries = await readDay(day);
    if (!entries.length) return { content: [{ type: 'text', text: `Nothing logged on ${day}.` }] };

    const body = entries
      .map((e) => `${e.time}${e.tags.length ? ' ' + e.tags.map((t) => '#' + t).join(' ') : ''}\n${e.text}`)
      .join('\n\n');
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
    const tagCount = new Map<string, number>();
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

    const topTags = [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, n]) => `#${t} (${n})`)
      .join(', ');

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
