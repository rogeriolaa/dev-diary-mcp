# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.1.0] - 2026-11-07

The release that makes the diary safe to actually use day to day: entries can be
corrected, searches are bounded, and the file format no longer round-trips
through a lossy parser.

### Added

- **`edit_entry` tool** — replaces an existing entry's text, addressed by date,
  time, and occurrence. Omitting `tags` keeps the entry's existing tags.
- **`delete_entry` tool** — removes a single existing entry, addressed the same
  way. Deleting an entry that does not exist returns an error instead of
  reporting success.
- **`occurrence` parameter** on `edit_entry` and `delete_entry` — entries are
  identified by date + time + occurrence, so two entries logged in the same
  minute stay individually addressable.
- **`time` parameter on `log_work`** — backfill an entry at a specific
  `HH:MM` instead of the current time.
- **Date-range search** — `search_diary` accepts inclusive `from` and `to`
  dates.
- **Bounded search** — `search_diary` accepts a `limit` (default 50, max 1000)
  so a large diary cannot flood the assistant's context in one response.
- **Unit test suite** (34 tests) covering the pure parsing and editing logic.
- **End-to-end test suite** (22 checks) driving a real MCP client over stdio
  and asserting on the resulting files.
- **GitHub Actions CI** running typecheck, build, unit tests, and end-to-end
  checks on every push and pull request.
- **`CHANGELOG.md`**.

### Fixed

- **Entries written by hand were silently deleted.** The previous
  implementation re-serialized an entire day file from its parsed entries
  after every write, so any Markdown in the file that was not a timestamped
  entry — a heading, a free-form note — was destroyed on the next append.
  Writes now append to the file, and edits are applied as surgical splices
  against the original text, so content the server does not understand is
  left untouched.
- **Entries could be lost to a write race.** MCP tool calls arrive
  concurrently over stdio. Two calls targeting the same day file could both
  read the file before either wrote, so one entry was dropped. All day-file
  mutations are now serialized through an in-process queue, and each write
  goes to a temporary file and is renamed into place, so a reader never sees a
  partially written file.
- **Searching and summarizing returned nothing.** The entry regex used `\z` as
  an end-of-string anchor. JavaScript has no such anchor — it is treated as a
  literal `z` — so no entry ever matched and the diary appeared empty even
  though entries were being written successfully.
- **`delete_entry` removed every entry sharing a time** rather than only the
  requested one. Logging twice in the same minute and deleting one entry
  destroyed both.
- **`delete_entry` reported success for entries that did not exist.**
- **`edit_entry` wiped existing tags** when `tags` was omitted.
- **Failed operations left stray day files.** Deleting from a date that had no
  file created an empty one, which then counted toward the stats and streak
  totals. Removing the last entry of a day now removes the day file.
- **`today` used UTC.** A user in a negative-UTC offset logging at 22:00 had
  their entry written to tomorrow's file. Dates now resolve in the local
  timezone.
- **The project could not be built from a fresh install.** `typescript` was
  not declared as a dependency, so `npm run build` failed with
  `tsc: command not found`.
- **Test files were compiled into `dist/`** and shipped in the npm package.
  A separate build config now excludes them.
- **The `bin` entry could not be executed directly.** `dist/server.js` had no
  shebang, so `npx dev-diary-mcp` did not work.

### Changed

- The storage logic moved to `src/storage.ts` as pure, side-effect-free
  functions that can be tested without an MCP transport; `src/server.ts` wires
  them to the tools.
- Tags are normalized on write: whitespace becomes a dash, junk-only tags are
  dropped, and duplicates are removed.
- `npm run typecheck` and `npm test` scripts added, along with
  `npm run test:e2e`.
- The demo client now computes its dates relative to today instead of using
  hardcoded dates, and exercises `edit_entry` and `delete_entry`.
- The README documents the correctness guarantees and no longer shows stale
  demo output. Setup instructions now lead with `npx dev-diary-mcp`, since the
  package is published to npm.
- The published tarball excludes the development test harness
  (`dist/e2e-check.js`) and includes `CHANGELOG.md`, so the npm package page
  shows the release notes.

## [1.0.0] - 2026-08-22

Initial release.

- MCP server exposing `log_work`, `search_diary`, `daily_summary`, and
  `stats`.
- Markdown storage: one file per day under `DIARY_DIR` (default `./diary`),
  entries as `## HH:MM #tag` headings.
- A demo client that drives the server end to end over stdio.

[Unreleased]: https://github.com/rogeriolaa/dev-diary-mcp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/rogeriolaa/dev-diary-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rogeriolaa/dev-diary-mcp/releases/tag/v1.0.0
