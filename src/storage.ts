/**
 * dev-diary-mcp — pure storage logic.
 *
 * The diary is a folder of Markdown files, one per day. Entries live in
 * `## HH:MM #tag` blocks. Everything in this module is side-effect free so
 * it can be unit tested without touching the filesystem.
 *
 * Design note: the file is NOT round-tripped through a parse/serialize
 * cycle. A day file may contain hand-written notes, headings or any other
 * Markdown the user added by hand — that content must survive every
 * operation. Edits are therefore applied as surgical splices against the
 * original text, never as "parse everything, re-render everything".
 */

export type DiaryEntry = {
  time: string; // HH:MM
  tags: string[];
  text: string;
};

/** An entry plus its offsets in the source Markdown, used for splicing. */
export type ParsedEntry = DiaryEntry & {
  /** Offset of the `##` that starts the entry. */
  start: number;
  /** Offset of the first non-whitespace character of the body. */
  textStart: number;
  /** Offset just past the last non-whitespace character of the body. */
  textEnd: number;
  /** Offset just past the whole body group (before the separator). */
  end: number;
};

// `d` gives us match indices so edits can be spliced into the original text.
const ENTRY_RE = /(?:^|\n)## (\d{2}:\d{2})([^\n]*)\n([\s\S]*?)(?=\n## \d{2}:\d{2}|$)/gd;

/** Parse a day file into entries, keeping the offsets needed for editing. */
export function parseEntries(md: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const m of md.matchAll(ENTRY_RE)) {
    const full = m.indices![0]!;
    const body = m.indices![3]!;
    const start = md[full[0]] === '\n' ? full[0] + 1 : full[0];
    const raw = m[3];
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const tags = [...m[2].matchAll(/#([\w-]+)/g)].map((t) => t[1]);
    out.push({
      time: m[1],
      tags,
      text: raw.trim(),
      start,
      textStart: body[0] + lead,
      textEnd: body[1] - trail,
      end: body[1],
    });
  }
  return out;
}

/** Normalize tags: trim, collapse whitespace to dashes, drop junk. */
export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of tags) {
    const cleaned = raw.trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}

/** Render one entry as Markdown (no trailing newline). */
export function renderEntry(time: string, tags: string[], text: string): string {
  const tagSuffix = tags.length ? ' ' + tags.map((t) => '#' + t).join(' ') : '';
  return `## ${time}${tagSuffix}\n${text.trim()}`;
}

/**
 * Append an entry to a day file, preserving every byte already in it.
 * Entries are separated by a blank line, matching the documented format.
 */
export function appendEntry(md: string, entry: DiaryEntry): string {
  const block = renderEntry(entry.time, entry.tags, entry.text);
  if (!md.trim()) return block + '\n';
  const sep = md.endsWith('\n\n') ? '' : md.endsWith('\n') ? '\n' : '\n\n';
  return md + sep + block + '\n';
}

/**
 * Replace one entry in place. `index` is the position in `parseEntries()`
 * order, so entries sharing the same HH:MM stay individually addressable.
 */
export function replaceEntry(md: string, index: number, entry: DiaryEntry): string {
  const parsed = parseEntries(md);
  const target = parsed[index];
  if (!target) return md;
  // Keep the original trailing whitespace of the body so blank-line
  // spacing between entries survives an edit.
  const tailWs = md.slice(target.textEnd, target.end);
  return (
    md.slice(0, target.start) +
    renderEntry(entry.time, entry.tags, entry.text) +
    tailWs +
    md.slice(target.end)
  );
}

/**
 * Remove one entry in place. Only the selected entry is removed — other
 * entries that happen to share the same HH:MM are left alone.
 */
export function removeEntry(md: string, index: number): string {
  const parsed = parseEntries(md);
  const target = parsed[index];
  if (!target) return md;
  const after = md.slice(target.end);
  // Drop one separator newline so we don't leave a leading blank line.
  const tail = after.startsWith('\n') ? after.slice(1) : after;
  return md.slice(0, target.start) + tail;
}

/** Find the index of the nth (1-based) entry with the given time. */
export function findByTime(md: string, time: string, occurrence = 1): number {
  const parsed = parseEntries(md);
  let seen = 0;
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].time === time) {
      seen++;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

/** Today's date in the local timezone (avoids UTC rollover at night). */
export function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Is `day` inside the inclusive [from, to] range? */
export function inRange(day: string, from?: string, to?: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
