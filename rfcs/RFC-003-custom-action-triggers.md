# RFC-003: Custom Action Triggers and Per-Animation Hotkeys

## Status: Active
## Date: 2026

## Problem

Custom animation rows added in step 2 (anything beyond the 7 default actions
Idle/Walk/Run/Attack/Jump/Hurt/Death) cannot be triggered in the in-app
viewport. The render loop hard-codes seven action slots:

```ts
if (gs.isDead) newAction = 6;
else if (gs.isAttacking) newAction = 3;
else if (keys.current['KeyH']) newAction = 5;
else if (keys.current['KeyJ'] || keys.current['KeyZ'] || keys.current['Enter']) newAction = 3;
else if (right/left arrow) newAction = 1 | 2;
```

There is no path that ever sets `newAction >= 7`, so the user can spend API
calls generating "Cast Spell", "Roll Dodge", "Throw Bomb", and they will
never play in the preview. The control bar also has no buttons for them.

Even for the seven default actions, the keybinds are hard-coded
(`KeyJ` for Attack, `KeyH` for Hurt, `KeyK` for Death). A user who prefers
a different layout has no way to change them.

## Goals

- **G1.** Every animation row, including custom ones, can be triggered in
  the viewport by a button and by a keyboard hotkey.
- **G2.** Hotkeys are user-configurable per animation, captured by clicking
  a binding chip and pressing a key.
- **G3.** The render loop respects each row's `loop` setting:
  `forward` = play while held, `once` = tap-to-play-through-then-Idle.
- **G4.** A `once` action in flight ignores re-triggers until it finishes.
- **G5.** Defaults are sensible and survive migration: existing characters
  get hotkeys assigned automatically.

## Non-goals

- Remapping Walk/Run/Jump. Locomotion is glued to physics (`vx`, `vy`,
  arrow + Shift modifier, gravity, platform collision) and remapping it
  brings little value at high implementation cost. Idle is the resting
  state, not a triggerable action.
- Conflict detection across characters or rows (we accept duplicate
  bindings — the first match in render order wins).
- Modifier-key combos (`Ctrl+J`, `Shift+Q`). Single-key only for v1.
- Gamepad / touch gestures.

## Design

### Data model

Add a `keyBind` field to each animation row:

```ts
animations: {
  id: string;
  name: string;
  customPrompt: string;
  fps: number;
  loop: 'forward' | 'pingpong' | 'once';
  /** KeyboardEvent.code for the trigger key. Empty string = no binding.
   *  Locomotion rows (rowIndex < 3) ignore this and use the legacy
   *  arrow + Shift handling. */
  keyBind: string;
}[]
```

`keyBind` stores `KeyboardEvent.code` (`"KeyJ"`, `"Digit1"`, `"Space"`,
`"Backquote"`) — locale-independent, matches what the existing render loop
already reads from `keys.current[code]`.

### Defaults and migration

`defaultPlaybackFor(name)` is extended to also return a default keyBind:

| Name (lowercase) | fps | loop    | keyBind   |
|------------------|-----|---------|-----------|
| idle             | 6   | forward | `""`      |
| walk             | 10  | forward | `""` (locomotion uses arrows) |
| run              | 12  | forward | `""` (locomotion + Shift)     |
| attack           | 14  | once    | `KeyJ`    |
| jump             | 10  | once    | `""` (locomotion uses Space/W) |
| hurt             | 8   | once    | `KeyH`    |
| death            | 8   | once    | `KeyK`    |
| (custom)         | 8   | forward | `Digit1..Digit9` |

The runtime migration in `storage.ts > migrateCharacter` fills missing
`keyBind` fields. For unrecognised animation names ("Cast", "Block",
"Roll"...) it assigns `Digit1`, `Digit2`, ... in order, skipping digits
already taken by other custom rows in the same character.

### Render loop refactor

The current cascade `isDead → isAttacking → KeyH → KeyJ → arrows` is
replaced with a generic dispatcher:

```ts
// Pseudocode for one render tick:

// 1. Continue an in-flight one-shot until its last frame.
if (gs.oneShotRow !== null) {
  newAction = gs.oneShotRow;
} else {
  // 2. Scan non-locomotion rows in priority order. Death > Hurt > Attack >
  //    custom-once > custom-forward (held). First match wins.
  let triggered = null;
  for (const row of nonLocomotionRows) {
    if (row.keyBind && keys.current[row.keyBind]) {
      triggered = row;
      if (row.loop === 'once') break;     // one-shot stops the scan
    }
  }
  if (triggered) {
    if (triggered.loop === 'once') {
      gs.oneShotRow = triggered.index;
      gs.frameIndex = 0;
      newAction = triggered.index;
    } else {
      newAction = triggered.index;        // hold-to-loop
    }
  } else {
    // 3. Fall through to locomotion: arrows + Shift + jump (unchanged).
  }
}

// 4. After frame tick: if the playing row is the active one-shot AND we
//    just landed on its last frame, clear gs.oneShotRow so the next tick
//    can return to Idle.
```

The Death special-case ("stay on last frame forever") is preserved by
treating Death's `loop === 'once'` row specifically: when its last frame is
reached, `gs.oneShotRow` is **not** cleared — it stays pinned. Revive
clears it manually (matching the existing handler).

`gs.isAttacking` and `gs.isDead` are kept as derived booleans for the
existing camera-shake / particle hooks, but their authoritative source
becomes `gs.oneShotRow === attackRowIndex` and `gs.oneShotRow === deathRowIndex`.

### UI: hotkey capture chip in step 2

Each animation row in step 2 gets a new chip below the loop selector:

```
[ ⌨ KeyJ ]   ← clickable; click then press a key to rebind
```

Click → chip enters "listening" state (border highlight, "Press a key…").
Next `keydown` (anywhere on the page while listening) sets the new
`keyBind`. `Escape` cancels. `Backspace`/`Delete` clears the binding to
empty string.

For locomotion rows (Idle/Walk/Run/Jump) the chip is shown but disabled
and labelled with the static binding (`Arrow keys`, `Arrow + Shift`,
`Space / W`) so the user understands they cannot rebind it.

### UI: dynamic action buttons in viewport

The hard-coded buttons (`Walk`, `Run`, `Jump`, `Attack`, `Hurt`, `Death`,
`Revive`, `+ Enemy`, `Clear`) become two groups:

**Locomotion group** (unchanged): `← Walk`, `Walk →`, `Run →`, `Jump`,
`Revive`, `+ Enemy`, `Clear`.

**Action group** (built from `animationsMeta`): one button per
non-locomotion row that has a binding. Label = `{anim.name}` with the
keybind shown as a `<kbd>` mark, e.g. `Attack ⌨ J`. Same press/release
semantics as the existing `CtrlBtn`: `pointerdown` simulates key down,
`pointerup` simulates key up. For `once` rows we tap (auto-release after
50ms) like the Death button does today.

If a row has no binding, the button shows but pressing it just simulates a
synthetic press of an internal pseudo-key tied to the row id, so it still
works without a keybind.

### Plumbing

`GameViewport` needs the full animation list (not just `fps + loop`) to
build buttons and read keyBinds. We extend `animationsMeta`:

```ts
animationsMeta?: {
  name: string;
  fps: number;
  loop: 'forward' | 'pingpong' | 'once';
  keyBind: string;
}[]
```

(Already a live ref — no restart of the render loop on edit.)

### Persistence

`keyBind` rides on `SavedCharacter.animations[]`, so the existing
IndexedDB save and project export/import paths cover it for free.

## Acceptance tests

1. **Default keybinds appear.** Open an existing project (RFC-002 saved
   characters) → step 2 → every row shows a hotkey chip with a sensible
   default. Walk/Run/Jump chips are disabled with the static label.
2. **Rebind works.** Click the Attack chip, press `KeyL`, chip shows
   `KeyL`. Reload page. Chip still says `KeyL`.
3. **Custom action gets a button.** Add a custom action "Cast Spell" with
   `loop: once`, generate (or skip if already), open step 3 viewport. A
   button labelled "Cast Spell ⌨ 1" exists.
4. **Custom action plays via button.** Click the Cast Spell button. The
   character plays Cast Spell frames once, then returns to Idle.
5. **Custom action plays via keyboard.** Press `Digit1`. Same as above.
6. **Forward-loop custom action holds.** Add a custom "Block" with
   `loop: forward`. Hold its key — viewport shows Block looping. Release
   — back to Idle.
7. **Once re-trigger ignored.** Press Attack key twice fast — only one
   Attack plays through, second press is dropped until the first
   completes.
8. **Death + Revive still work.** Click Death (or press its bound key)
   → death plays and pins on last frame. Click Revive → returns to Idle.
   Holding Walk → walks. (Regression guard for the bug fixed last round.)
9. **Migration assigns keybinds.** Load a pre-RFC-003 project file (no
   `keyBind` fields) → all rows get sensible defaults; custom rows get
   `Digit1`, `Digit2`, ... in order.
10. **No double-binding crash.** Two rows bound to the same key both
    trigger; the priority order (Death > Hurt > Attack > custom in row
    order) decides which one plays.

## Risks

- **R1 — Listening-mode key leak.** The capture chip listens via a
  document-level `keydown` while active. If the user navigates away
  mid-capture the listener must clean up. Mitigated by `useEffect` with
  proper teardown.
- **R2 — Locomotion override.** A user could try to bind a custom action
  to `ArrowRight`. The dispatcher checks non-locomotion rows first, so
  this would block walking. We disable common locomotion codes
  (`ArrowLeft/Right/Up/Down`, `KeyA/D/W/S`, `Space`, `ShiftLeft/Right`)
  in the capture chip and surface a "Reserved key" hint.
- **R3 — Existing `KeyJ`/`KeyZ`/`Enter` for Attack.** The legacy code
  accepted three keys for Attack. New design: only the configured
  `keyBind` triggers each row. This is a small behavior shift; the
  default keyBind for Attack is `KeyJ` so the most common case keeps
  working. `KeyZ` and `Enter` are dropped (documented in the README).
