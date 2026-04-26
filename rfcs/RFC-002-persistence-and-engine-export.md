# RFC-002: Persistence, Project Files, and Engine-Ready Export

## Status: Active
## Date: 2026

## Problem

The current engine has three production blockers that prevent users from
treating it as a real game-asset pipeline:

1. **No persistence.** `savedChars` lives only in React state. A page refresh
   wipes every generated character, animation strip, compiled sprite sheet,
   and group layout. Each character costs 5–50 paid Gemini calls, so this is
   not a minor annoyance — it's a hard blocker for any non-trivial usage.

2. **No way to back up or share work.** A user cannot move a project between
   machines, share a hero with a teammate, or roll back to an earlier state.
   There is no `.json` project format, no import, no export.

3. **Atlas JSON is custom and half-compatible.** The current export emits a
   shape that loosely resembles TexturePacker, but no real game engine reads
   it directly:
   - Phaser 3 needs TexturePacker's `frames[]` array form OR Aseprite Hash form.
   - Godot 4 reads Aseprite's `meta.frameTags` for animation slicing.
   - The current export has no `duration` per frame, no loop direction, no
     per-row playback rate. The viewport bakes a hard-coded 200ms.
   - `frames` is a record keyed by `name_index`, but `meta.frameTags` indices
     don't actually match TexturePacker's "global frame index" convention,
     and `animations` is a parallel structure that no importer reads.

The result is that a user who wants to drop the output into Godot has to
hand-write `SpriteFrames`, and a Phaser user has to manually call
`anims.create` for every action with hard-coded frame ranges.

## Goals

- **G1.** Survive a page reload. No lost work after refresh, browser crash,
  or accidental tab close.
- **G2.** Export a single self-contained project file that contains every
  character, every generated frame, and every UI grouping, and re-import it
  losslessly.
- **G3.** Emit a sprite-sheet JSON that Aseprite-aware importers (Phaser 3,
  Godot's Aseprite importer plugin, custom Unity importers) read with zero
  hand-editing, including per-frame duration and loop direction.
- **G4.** Expose per-row playback metadata (fps, loop type) in the UI so the
  exported JSON reflects user intent, and the in-app viewport plays at the
  same speed the engine will.

## Non-goals (deferred to later RFCs)

- Multi-direction sprites (4-dir / 8-dir). Tracked separately — needs prompt
  pipeline changes.
- Backend API-key proxy. Tracked separately — security RFC.
- Hitbox / pivot editor. Out of scope for this RFC (pivot is bottom-center).
- Cloud sync / multi-device. Local IndexedDB only.

## Design

### G1 — Persistence

#### Storage choice: IndexedDB via `idb-keyval`

`localStorage` is unusable: it caps at ~5 MB and stores strings only. A single
character with 7 animations × 4 frames of 128×128 PNG data-URLs is already
~1.5 MB — five characters blow the budget.

IndexedDB has no practical size cap (browsers grant tens to hundreds of MB by
default and prompt the user past that). `idb-keyval` is a 600-byte wrapper
that exposes `get(k)` / `set(k, v)` with structured-clone serialization, so
arrays of objects with embedded data-URL strings serialize natively.

#### Schema

Two keys in one IndexedDB database `pixel-engine-v1`:

```
key: "savedChars"   value: SavedCharacter[]
key: "emptyGroups"  value: string[]
```

A `schemaVersion: 1` field is added to `SavedCharacter` so future migrations
are explicit. An older saved character missing the field is treated as
version 0 and upgraded on read (idempotent — adds default `frameCounts` and
default per-row playback metadata, see G4).

#### Read path

On app mount, a new `useEffect` reads both keys. While the read is in
flight, the UI shows a brief "Loading project…" state to avoid a flash of
the empty-landing screen for returning users. If the read fails (corrupt
DB, quota error), we log and fall back to empty state — never throw into
the React tree.

#### Write path

A debounced writer (500 ms) flushes `savedChars` and `emptyGroups` whenever
they change. Debouncing matters because generation triggers many rapid
state updates (per-frame progress) and we don't want to write 30 times per
animation row. A 500 ms tail also coalesces rapid UI edits like rename.

The writer is a single effect in `App.tsx` watching both arrays. Errors
(typically `QuotaExceededError`) surface as a toast via the existing
`errorMsg` channel; the in-memory state is never blocked on write success.

#### Edge cases

- **First load with no DB.** Read returns `undefined`; we initialize with
  empty arrays. No write happens until the user creates something.
- **Migration.** `savedChars` may be missing `frameCounts` (old format) or
  the new playback fields. The read function maps each character through
  `migrateCharacter()` which fills defaults idempotently.
- **Active char id.** Persisted separately as `activeCharId`. If the saved
  id no longer exists after a load (deleted across sessions on another
  tab), we clear it.

### G2 — Project file export / import

A "project file" is a single `.json` with this shape:

```jsonc
{
  "format": "pixel-engine-project",
  "version": 1,
  "exportedAt": "2026-04-26T12:00:00.000Z",
  "characters": SavedCharacter[],   // exact in-memory shape, includes data URLs
  "emptyGroups": string[]
}
```

Embedding data-URLs makes the file portable but large (a 7-character project
can be 50–200 MB). That is the right trade-off for v1: no asset host, no
cloud, just a single file you can drop on Discord. We document the size in
the UI before download.

#### Import behavior

- Validate `format === "pixel-engine-project"` and `version <= 1`.
- Run each imported character through the same `migrateCharacter()` used
  on IndexedDB read, so an old project file imports cleanly.
- Two import modes, exposed as a radio in the import dialog:
  - **Merge.** Append imported characters under their original groups.
    Collisions on `id` get a fresh id (`<old>-import-<rand>`).
  - **Replace.** Wipe current state, replace with the imported file. Behind
    a confirm step.

#### UI surface

A new "Project" menu item in the header (next to "Start your hero") opens a
small popover with:
- "Export project (.json)" — triggers a download of the full state.
- "Import project (.json)" — opens a file picker, then a merge/replace
  dialog.
- File-size estimate next to "Export" so users aren't surprised by a 100 MB
  download.

### G3 — Aseprite-compatible JSON export

The current export emits one custom shape. We replace it with **two**
exports the user can pick from at download time:

#### Aseprite "Hash" format (recommended default)

This is the format every modern 2D engine importer understands.

```jsonc
{
  "frames": {
    "hero idle 0.png": {
      "frame":            { "x": 0,  "y": 0,  "w": 64, "h": 64 },
      "rotated":          false,
      "trimmed":          false,
      "spriteSourceSize": { "x": 0,  "y": 0,  "w": 64, "h": 64 },
      "sourceSize":       { "w": 64, "h": 64 },
      "duration":         150
    },
    "hero idle 1.png": { ... }
  },
  "meta": {
    "app":      "https://github.com/.../pixel-engine",
    "version":  "1.0",
    "image":    "spritesheet.png",
    "format":   "RGBA8888",
    "size":     { "w": 256, "h": 448 },
    "scale":    "1",
    "frameTags": [
      { "name": "idle",  "from": 0, "to": 3, "direction": "forward" },
      { "name": "walk",  "from": 4, "to": 7, "direction": "forward" },
      ...
    ]
  }
}
```

Critical properties:
- **Frame keys follow Aseprite's `<sprite> <tag> <frame>.png` convention.**
  Phaser auto-detects, Godot's plugin reads tag from this string.
- **`frameTags[].from/to` are global frame indices** counted across all
  rows in row-major order, exactly matching the order Aseprite writes when
  it exports a multi-tag sheet.
- **`duration` is per-frame in milliseconds.** Comes from G4 metadata.
- **`direction`** is per-tag and reflects the loop type the user picked
  (`forward`, `pingpong`, or `forward` for one-shots — Aseprite has no
  `once` value, so we encode "play once" as a forward loop and document
  that the engine should clamp via the `repeat` property; see G4).

#### TexturePacker JSON-Array format (alternate)

For users who prefer the `frames` array form (some Phaser tutorials, some
Cocos workflows):

```jsonc
{
  "textures": [{
    "image": "spritesheet.png",
    "format": "RGBA8888",
    "size": { "w": ..., "h": ... },
    "scale": 1,
    "frames": [
      { "filename": "idle_0", "frame": {...}, "duration": 150, ... },
      ...
    ]
  }],
  "meta": { ... "frameTags": [...] }
}
```

Both formats are emitted from one shared `buildAtlas(meta, format)` function
so they cannot drift.

### G4 — Per-row playback metadata

Add two fields to each animation entry on `SavedCharacter`:

```ts
animations: {
  id: string;
  name: string;
  customPrompt: string;
  /** Frames per second. Default 8. Range 1–30. */
  fps: number;
  /** Loop behavior in the engine. */
  loop: 'forward' | 'pingpong' | 'once';
}[]
```

Defaults per known animation name (so existing characters auto-fill on
migration without prompting the user):

| Name   | fps | loop      |
|--------|-----|-----------|
| Idle   | 6   | forward   |
| Walk   | 10  | forward   |
| Run    | 12  | forward   |
| Attack | 14  | once      |
| Jump   | 10  | once      |
| Hurt   | 8   | once      |
| Death  | 8   | once      |
| (other)| 8   | forward   |

Editing surface: a small dropdown for loop type and a numeric stepper for
fps next to the existing frame-count stepper in the per-row card. The
viewport's playback uses the same fps, replacing the current hard-coded
180 ms idle / `speed` for everything else, so what the user sees in-app
matches what their engine plays.

#### Aseprite encoding

- `duration_ms = round(1000 / fps)`
- `direction = loop === 'pingpong' ? 'pingpong' : 'forward'`
- One-shot semantics: Aseprite's format has no "once" flag. We add a
  vendor extension `meta.frameTags[].repeat: "1"` for `once`, and document
  it. Phaser, Godot, and Unity importers ignore unknown fields. Users who
  want strict one-shot behaviour read `repeat` themselves; everyone else
  treats it as forward and stops at `to`.

## Acceptance tests

Manual UI/UX checklist run after implementation:

1. **Persistence round-trip.** Create 2 characters, generate 2 animations
   on one of them, hard reload the page. Both characters and the generated
   animation come back with the same compiled sprite sheet visible.
2. **Group layout persists.** Create a custom group "Bosses", drag a
   character into it, reload. Group still exists with the character in it.
3. **Active char persists.** Open a character into step 2, reload. Land
   back in step 2 on the same character (or step 1 if we choose; whichever
   we pick must be deterministic).
4. **Empty-state fast path.** First-ever load (DB empty) shows the
   landing page within 200 ms — no loading flash longer than that.
5. **Export → Import round-trip.** Export a 2-character project, refresh
   to clear, import. State matches byte-for-byte (modulo new ids on
   merge mode).
6. **Import merge.** With one character already saved, import a 2-char
   project in merge mode. Total count is 3, no id collision crash.
7. **Import replace.** With one character saved, import a 2-char project
   in replace mode. Total count is 2.
8. **Reject invalid file.** Importing a random JSON or a v999 project
   shows an error toast and does not corrupt state.
9. **fps + loop UI.** Editing fps for Walk row updates the in-app viewport
   speed immediately. Editing loop to pingpong makes the viewport
   ping-pong (or the export reflects it; viewport ping-pong is a stretch
   goal — see Risks).
10. **Aseprite export validity.** Open the exported JSON in a JSON linter,
    verify it matches the documented shape, verify `frameTags` indices
    are correct for a character with mixed frame counts (e.g. Idle=4,
    Walk=6, Attack=8).
11. **Per-frame duration.** Setting Walk fps to 12 produces
    `duration: 83` (round(1000/12)) on every Walk frame in the export.
12. **TexturePacker variant.** Same character exports cleanly to the
    array variant; `meta.frameTags` are identical.

## Risks and mitigations

- **R1 — IndexedDB write storms during generation.** Mitigated by 500 ms
  debounce + structural-equality check before writing.
- **R2 — Quota exceeded on huge projects.** Surface as a toast, do not
  block UI. Document recommended size in README.
- **R3 — Migration drift.** All migrations are pure functions, exercised
  by unit-style assertions in dev (a small `migrate.test-ish.ts` we run
  manually; full Vitest is deferred — the goal here is to ship, not to
  add a test framework).
- **R4 — Aseprite spec ambiguity for one-shot.** Documented explicitly via
  the `repeat` field; default behavior is safe (forward loop) for
  importers that don't read it.
- **R5 — Viewport ping-pong.** The current viewport is forward-only. We
  plumb fps through immediately; ping-pong playback in the viewport is
  best-effort and may land in a follow-up if it bloats this RFC's scope.

## Out of scope (explicitly)

- Multi-direction sprite layouts.
- Pivot / hitbox metadata in the export.
- Cloud sync.
- Headless CLI.
- Tilesets / icons / background generation.
- Vitest harness.
