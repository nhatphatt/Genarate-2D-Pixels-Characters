/**
 * Persistence layer for the engine.
 *
 * RFC-002 §G1.
 *
 * Stores the project's `savedChars`, `emptyGroups`, and `activeCharId` in
 * IndexedDB via `idb-keyval`. Reads on app mount, debounced writes whenever
 * the watched state changes.
 *
 * Why IndexedDB and not localStorage:
 *   localStorage caps at ~5 MB and stores strings only. A single character
 *   with 7 animations × 4 frames of 128×128 PNG data-URLs is already ~1.5 MB,
 *   so 3–4 characters blow the budget. IndexedDB has no practical cap and
 *   `idb-keyval` lets us store the arrays directly via structured clone.
 */
import { get, set, createStore } from 'idb-keyval';
import type { SavedCharacter } from '../components/HeroGallery';

// One named DB so future schema migrations can bump the suffix without
// stepping on older saved data.
const STORE = createStore('pixel-engine-v1', 'kv');

const KEY_CHARS = 'savedChars';
const KEY_GROUPS = 'emptyGroups';
const KEY_ACTIVE = 'activeCharId';

/** Schema version stamped on every persisted character. */
export const CURRENT_SCHEMA = 1 as const;

/** Default per-row playback when a known animation name has no metadata. */
const DEFAULT_PLAYBACK: Record<string, { fps: number; loop: 'forward' | 'pingpong' | 'once'; keyBind: string }> = {
  // Locomotion is wired to arrows + Shift in the viewport, not to a single
  // KeyboardEvent.code, so keyBind stays empty and the UI shows a static
  // "Arrow keys" hint instead.
  idle:   { fps: 6,  loop: 'forward', keyBind: ''     },
  walk:   { fps: 10, loop: 'forward', keyBind: ''     },
  run:    { fps: 12, loop: 'forward', keyBind: ''     },
  jump:   { fps: 10, loop: 'once',    keyBind: ''     },
  // Triggerable actions get a default code so the Step 3 viewport can
  // surface a button and a hotkey out of the box.
  attack: { fps: 14, loop: 'once',    keyBind: 'KeyJ' },
  hurt:   { fps: 8,  loop: 'once',    keyBind: 'KeyH' },
  death:  { fps: 8,  loop: 'once',    keyBind: 'KeyK' },
};
const FALLBACK_PLAYBACK = { fps: 8, loop: 'forward' as const, keyBind: '' };

/** Pick the right default fps/loop/keyBind for a freshly-created animation row. */
export function defaultPlaybackFor(name: string): { fps: number; loop: 'forward' | 'pingpong' | 'once'; keyBind: string } {
  return DEFAULT_PLAYBACK[name.trim().toLowerCase()] ?? FALLBACK_PLAYBACK;
}

/** Codes the locomotion + system bindings already use. The capture chip
 *  rejects these to prevent a custom action from blocking the viewport's
 *  built-in walk/run/jump handling. RFC-003 §Risks R2. */
export const RESERVED_KEY_CODES = new Set<string>([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyW', 'KeyS',
  'Space',
  'ShiftLeft', 'ShiftRight',
]);

/**
 * Pick a fresh `Digit1..Digit9` keybind for a custom (unrecognised) animation
 * row, skipping any digit already taken by other rows in the same character.
 * Falls back to empty string when more than 9 custom rows exist (the user
 * can still trigger them via the in-app button — the chip just shows "—").
 */
function pickFreshDigitBind(taken: Set<string>): string {
  for (let n = 1; n <= 9; n++) {
    const code = `Digit${n}`;
    if (!taken.has(code)) return code;
  }
  return '';
}

/**
 * Idempotent migration from any older shape to the current schema.
 *
 * Older characters (pre RFC-002) may be missing:
 *   - `frameCounts`            → fill with 4 per row
 *   - per-animation `fps/loop` → fill from `defaultPlaybackFor(name)`
 *   - `schemaVersion`          → stamp CURRENT_SCHEMA
 *
 * Run this on every read so the in-memory shape is always current.
 */
export function migrateCharacter(c: any): SavedCharacter {
  const animations = Array.isArray(c.animations) ? c.animations : [];

  // First pass: gather already-claimed keybinds so the second pass can
  // assign fresh Digit1..Digit9 bindings to unrecognised rows without
  // colliding with the seven defaults or with explicit user-set codes.
  const claimed = new Set<string>();
  for (const a of animations) {
    const def = defaultPlaybackFor(a?.name ?? '');
    const explicit = typeof a?.keyBind === 'string' ? a.keyBind : null;
    const effective = explicit !== null ? explicit : def.keyBind;
    if (effective) claimed.add(effective);
  }

  const migratedAnims = animations.map((a: any) => {
    const def = defaultPlaybackFor(a?.name ?? '');
    let keyBind: string;
    if (typeof a?.keyBind === 'string') {
      // Already migrated or explicitly set — preserve verbatim.
      keyBind = a.keyBind;
    } else if (def.keyBind || isLocomotionName(a?.name ?? '')) {
      // Recognised name: use the preset (which may be empty for locomotion).
      keyBind = def.keyBind;
    } else {
      // Unknown custom action: hand it the next free digit.
      const fresh = pickFreshDigitBind(claimed);
      if (fresh) claimed.add(fresh);
      keyBind = fresh;
    }
    return {
      id:           a?.id ?? Math.random().toString(36).slice(2),
      name:         a?.name ?? 'Custom Action',
      customPrompt: a?.customPrompt ?? '',
      fps:          typeof a?.fps === 'number' ? clampFps(a.fps) : def.fps,
      loop:         (a?.loop === 'forward' || a?.loop === 'pingpong' || a?.loop === 'once') ? a.loop : def.loop,
      keyBind,
    };
  });

  const expected = migratedAnims.length;
  const frameCounts: number[] = (Array.isArray(c.frameCounts) && c.frameCounts.length === expected)
    ? c.frameCounts.map((n: any) => clampFrames(n))
    : migratedAnims.map(() => 4);

  const animRows = (Array.isArray(c.animRows) && c.animRows.length === expected)
    ? c.animRows
    : migratedAnims.map(() => null);

  const animRowsNoBg = (Array.isArray(c.animRowsNoBg) && c.animRowsNoBg.length === expected)
    ? c.animRowsNoBg
    : migratedAnims.map(() => null);

  return {
    id:           c.id ?? (Date.now().toString() + Math.random().toString(36).slice(2, 6)),
    name:         c.name ?? 'Hero',
    prompt:       c.prompt ?? '',
    group:        c.group ?? 'Ungrouped',
    artStyle:     c.artStyle ?? 'pixel',
    perspective:  c.perspective ?? 'platformer',
    rawImage:     c.rawImage ?? '',
    cleanImage:   c.cleanImage ?? c.rawImage ?? '',
    animations:   migratedAnims,
    frameCounts,
    animRows,
    animRowsNoBg,
    spriteSheet:  c.spriteSheet ?? null,
    // @ts-expect-error — added at runtime for future migrations
    schemaVersion: CURRENT_SCHEMA,
  };
}

/** Names the dispatcher treats as locomotion (arrow keys + Shift + Space).
 *  These rows do NOT use a single keyBind — the static label is shown in
 *  the UI instead. RFC-003. */
const LOCOMOTION_NAMES = new Set(['idle', 'walk', 'run', 'jump']);
export function isLocomotionName(name: string): boolean {
  return LOCOMOTION_NAMES.has(name.trim().toLowerCase());
}

const clampFps = (n: number) => Math.max(1, Math.min(30, Math.round(n)));
const clampFrames = (n: any) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 4;
  return Math.max(1, Math.min(10, Math.round(x)));
};

export interface LoadedState {
  savedChars: SavedCharacter[];
  emptyGroups: string[];
  activeCharId: string | null;
}

/**
 * Read everything from IndexedDB. Always resolves — corrupt / missing /
 * quota-failed reads yield empty defaults so the app never blocks on boot.
 */
export async function loadState(): Promise<LoadedState> {
  try {
    const [chars, groups, active] = await Promise.all([
      get<unknown>(KEY_CHARS, STORE),
      get<unknown>(KEY_GROUPS, STORE),
      get<unknown>(KEY_ACTIVE, STORE),
    ]);

    const savedChars = Array.isArray(chars) ? chars.map(migrateCharacter) : [];
    const emptyGroups = Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
    let activeCharId: string | null = typeof active === 'string' ? active : null;
    // Drop dangling activeCharId if its target was deleted in another tab.
    if (activeCharId && !savedChars.find(c => c.id === activeCharId)) {
      activeCharId = null;
    }
    return { savedChars, emptyGroups, activeCharId };
  } catch (e) {
    console.warn('[storage] loadState failed, falling back to empty', e);
    return { savedChars: [], emptyGroups: [], activeCharId: null };
  }
}

/**
 * Write all three keys. Best-effort — failures are reported via the
 * onError callback so the caller can surface a toast, but the in-memory
 * state is never blocked on a successful write.
 */
export async function saveState(
  state: LoadedState,
  onError?: (e: unknown) => void,
): Promise<void> {
  try {
    await Promise.all([
      set(KEY_CHARS, state.savedChars, STORE),
      set(KEY_GROUPS, state.emptyGroups, STORE),
      set(KEY_ACTIVE, state.activeCharId, STORE),
    ]);
  } catch (e) {
    console.warn('[storage] saveState failed', e);
    onError?.(e);
  }
}
