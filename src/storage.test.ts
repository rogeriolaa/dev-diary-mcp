import { describe, it, expect } from 'vitest';
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

describe('parseEntries', () => {
  it('parses a single entry with tags', () => {
    const md = `## 14:32 #bugfix #websocket\nFixed the race condition in the queue\n`;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].time).toBe('14:32');
    expect(entries[0].tags).toEqual(['bugfix', 'websocket']);
    expect(entries[0].text).toBe('Fixed the race condition in the queue');
  });

  it('parses multiple entries', () => {
    const md = `## 09:00 #standup\nStarted the day\n\n## 14:32 #bugfix\nFixed the bug\n`;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('Started the day');
    expect(entries[1].text).toBe('Fixed the bug');
  });

  it('keeps multi-line entry text intact', () => {
    const md = `## 10:00 #refactor\nThis entry spans\nmultiple lines of text\n\n## 11:00\nNext entry\n`;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('This entry spans\nmultiple lines of text');
    expect(entries[1].text).toBe('Next entry');
  });

  it('returns empty array for empty string', () => {
    expect(parseEntries('')).toEqual([]);
  });

  it('ignores headings that are not entries', () => {
    const md = `# My Diary\n\nSome intro text\n\n## 10:00 #note\nReal entry here\n`;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].time).toBe('10:00');
  });

  it('parses entries separated by a single newline', () => {
    const md = `## 09:00 #a\nfirst\n## 10:00 #b\nsecond\n`;
    const entries = parseEntries(md);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('first');
    expect(entries[1].text).toBe('second');
  });
});

describe('appendEntry', () => {
  it('creates a new file for the first entry', () => {
    const out = appendEntry('', { time: '10:00', tags: ['x'], text: 'hello' });
    expect(out).toBe('## 10:00 #x\nhello\n');
    expect(parseEntries(out)).toHaveLength(1);
  });

  it('appends without destroying hand-written content', () => {
    // Regression: an earlier implementation re-serialized the whole file from
    // parsed entries, silently deleting any content it did not understand.
    const handWritten = `# My Diary 2026-11-07\n\nSome free-form note I wrote by hand.\n\n## 09:00 #standup\nMorning standup notes\n`;
    const out = appendEntry(handWritten, { time: '10:00', tags: ['work'], text: 'new entry' });

    expect(out).toContain('# My Diary 2026-11-07');
    expect(out).toContain('Some free-form note I wrote by hand.');
    expect(out).toContain('## 09:00 #standup');
    expect(out).toContain('## 10:00 #work');
    expect(parseEntries(out)).toHaveLength(2);
  });

  it('separates appended entries with a blank line', () => {
    const first = appendEntry('', { time: '10:00', tags: [], text: 'one' });
    const second = appendEntry(first, { time: '11:00', tags: [], text: 'two' });
    expect(second).toContain('one\n\n## 11:00');
    expect(parseEntries(second)).toHaveLength(2);
  });

  it('roundtrips through append + parse', () => {
    let md = '';
    md = appendEntry(md, { time: '10:00', tags: ['a'], text: 'one' });
    md = appendEntry(md, { time: '11:00', tags: ['b'], text: 'two' });
    const entries = parseEntries(md);
    expect(entries.map((e) => e.text)).toEqual(['one', 'two']);
    expect(entries.map((e) => e.tags[0])).toEqual(['a', 'b']);
  });
});

describe('replaceEntry', () => {
  it('replaces the target entry text', () => {
    const md = `## 09:00 #a\nold text\n\n## 10:00 #b\nother\n`;
    const out = replaceEntry(md, 1, { time: '10:00', tags: ['b'], text: 'new text' });
    expect(out).toContain('old text');
    expect(out).toContain('new text');
    expect(out).not.toContain('other');
    expect(parseEntries(out)[1].text).toBe('new text');
  });

  it('preserves hand-written content', () => {
    const md = `# Header\n\nhand note\n\n## 09:00 #a\nold text\n`;
    const out = replaceEntry(md, 0, { time: '09:00', tags: ['a'], text: 'new text' });
    expect(out).toContain('# Header');
    expect(out).toContain('hand note');
    expect(out).toContain('new text');
  });

  it('preserves blank-line spacing between entries', () => {
    const md = `## 09:00 #a\none\n\n## 10:00 #b\ntwo\n`;
    const out = replaceEntry(md, 0, { time: '09:00', tags: ['a'], text: 'edited' });
    expect(out).toContain('edited\n\n## 10:00');
  });

  it('returns the input unchanged for an out-of-range index', () => {
    const md = `## 09:00 #a\none\n`;
    expect(replaceEntry(md, 5, { time: '09:00', tags: [], text: 'x' })).toBe(md);
  });

  it('edits only the targeted entry when times collide', () => {
    const md = `## 17:34 #a\nfirst\n\n## 17:34 #b\nsecond\n`;
    const out = replaceEntry(md, 1, { time: '17:34', tags: ['b'], text: 'edited second' });
    expect(out).toContain('first');
    expect(out).toContain('edited second');
    expect(out).not.toContain('\nsecond\n');
  });
});

describe('removeEntry', () => {
  it('removes only the target entry', () => {
    const md = `## 09:00 #a\none\n\n## 10:00 #b\ntwo\n`;
    const out = removeEntry(md, 0);
    expect(out).not.toContain('one');
    expect(out).toContain('two');
    expect(parseEntries(out)).toHaveLength(1);
  });

  it('removes only one entry when times collide', () => {
    // Regression: an earlier implementation deleted every entry matching the
    // time, so logging twice in the same minute destroyed both.
    const md = `## 17:34 #a\nfirst\n\n## 17:34 #b\nsecond\n`;
    const out = removeEntry(md, 0);
    const entries = parseEntries(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('second');
  });

  it('preserves hand-written content', () => {
    const md = `# Header\n\nhand note\n\n## 09:00 #a\none\n`;
    const out = removeEntry(md, 0);
    expect(out).toContain('# Header');
    expect(out).toContain('hand note');
    expect(parseEntries(out)).toHaveLength(0);
  });

  it('returns the input unchanged for an out-of-range index', () => {
    const md = `## 09:00 #a\none\n`;
    expect(removeEntry(md, 5)).toBe(md);
  });
});

describe('findByTime', () => {
  it('finds the first matching entry', () => {
    const md = `## 09:00 #a\none\n\n## 10:00 #b\ntwo\n`;
    expect(findByTime(md, '10:00')).toBe(1);
  });

  it('disambiguates entries sharing a time via occurrence', () => {
    const md = `## 17:34 #a\nfirst\n\n## 17:34 #b\nsecond\n`;
    expect(findByTime(md, '17:34', 1)).toBe(0);
    expect(findByTime(md, '17:34', 2)).toBe(1);
  });

  it('returns -1 when the time is not found', () => {
    const md = `## 09:00 #a\none\n`;
    expect(findByTime(md, '23:59')).toBe(-1);
    expect(findByTime(md, '09:00', 2)).toBe(-1);
  });
});

describe('sanitizeTags', () => {
  it('replaces whitespace with dashes', () => {
    expect(sanitizeTags(['my tag'])).toEqual(['my-tag']);
  });

  it('drops empty and junk-only tags', () => {
    expect(sanitizeTags(['   ', '!!!', 'ok'])).toEqual(['ok']);
  });

  it('deduplicates tags', () => {
    expect(sanitizeTags(['a', 'a'])).toEqual(['a']);
  });

  it('leaves clean tags untouched', () => {
    expect(sanitizeTags(['bugfix', 'web-socket'])).toEqual(['bugfix', 'web-socket']);
  });
});

describe('inRange', () => {
  it('includes day within range', () => {
    expect(inRange('2026-08-15', '2026-08-10', '2026-08-20')).toBe(true);
  });

  it('excludes day before from', () => {
    expect(inRange('2026-08-05', '2026-08-10', '2026-08-20')).toBe(false);
  });

  it('excludes day after to', () => {
    expect(inRange('2026-08-25', '2026-08-10', '2026-08-20')).toBe(false);
  });

  it('works with only from or only to', () => {
    expect(inRange('2026-08-15', '2026-08-10')).toBe(true);
    expect(inRange('2026-08-05', '2026-08-10')).toBe(false);
    expect(inRange('2026-08-15', undefined, '2026-08-20')).toBe(true);
    expect(inRange('2026-08-25', undefined, '2026-08-20')).toBe(false);
  });

  it('includes boundary dates', () => {
    expect(inRange('2026-08-10', '2026-08-10', '2026-08-20')).toBe(true);
    expect(inRange('2026-08-20', '2026-08-10', '2026-08-20')).toBe(true);
  });

  it('returns true with no filters', () => {
    expect(inRange('2026-08-15')).toBe(true);
  });
});

describe('todayLocal', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(todayLocal())).toBe(true);
  });

  it('matches the local calendar date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayLocal()).toBe(expected);
  });
});
