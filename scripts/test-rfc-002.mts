/**
 * Manual logic checks for RFC-002 deliverables.
 *
 * Not a real test framework — just a `tsx` script. Run with:
 *   npx tsx scripts/test-rfc-002.mts
 *
 * Exits 0 on success, 1 on first failure.
 */
import {
  buildAsepriteAtlas,
  buildTexturePackerAtlas,
  fpsToDuration,
  type AnimationMeta,
  type SheetGeometry,
} from '../src/lib/atlas.ts';
import {
  buildProjectFile,
  parseProjectFile,
  applyImport,
  ProjectImportError,
  PROJECT_FORMAT,
} from '../src/lib/projectFile.ts';
import { migrateCharacter, defaultPlaybackFor, CURRENT_SCHEMA } from '../src/lib/storage.ts';

let failed = 0;

function check(name: string, cond: any, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function eq<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

console.log('--- atlas builder ---');

const geom: SheetGeometry = {
  frameW: 64, frameH: 64,
  cols: 8, rows: 3,
  sheetW: 64 * 8, sheetH: 64 * 3,
};
const anims: AnimationMeta[] = [
  { name: 'Idle',   frameCount: 4, fps: 6,  loop: 'forward'  },
  { name: 'Walk',   frameCount: 6, fps: 12, loop: 'forward'  },
  { name: 'Attack', frameCount: 8, fps: 14, loop: 'once'     },
];

eq(fpsToDuration(8),   125, 'fpsToDuration(8) = 125');
eq(fpsToDuration(12),  83,  'fpsToDuration(12) = 83');
eq(fpsToDuration(60),  17,  'fpsToDuration(60) = 17');

const ase = buildAsepriteAtlas({
  imageFilename: 'spritesheet.png',
  spriteName: 'Knight Hero',
  geometry: geom,
  animations: anims,
});

// Frame keys follow Aseprite "<sprite> <tag> <i>.png" convention with slugged names.
check('Aseprite frame key has expected slug',
  Object.keys(ase.frames).includes('knight_hero idle 0.png'),
  Object.keys(ase.frames).slice(0, 3).join(' | '));

// Total frame entries = sum of frame counts (not cols × rows).
eq(Object.keys(ase.frames).length, 4 + 6 + 8, 'frame count = 4+6+8 = 18');

// Tag indices are GLOBAL across rows in row order.
eq(ase.meta.frameTags[0], { name: 'idle',   from: 0,  to: 3,  direction: 'forward' }, 'idle tag 0..3');
eq(ase.meta.frameTags[1], { name: 'walk',   from: 4,  to: 9,  direction: 'forward' }, 'walk tag 4..9');
eq(ase.meta.frameTags[2], { name: 'attack', from: 10, to: 17, direction: 'forward', repeat: '1' }, 'attack tag 10..17 + repeat=1');

// Per-frame duration matches fps→ms conversion.
eq(ase.frames['knight_hero walk 3.png'].duration, fpsToDuration(12), 'walk frame duration = 1000/12');
eq(ase.frames['knight_hero idle 2.png'].duration, fpsToDuration(6),  'idle frame duration = 1000/6');

// Frame coordinates land in the right cell.
eq(ase.frames['knight_hero walk 5.png'].frame, { x: 5 * 64, y: 1 * 64, w: 64, h: 64 }, 'walk frame 5 coord');

// pingpong direction
const ase2 = buildAsepriteAtlas({
  imageFilename: 's.png', spriteName: 'x', geometry: geom,
  animations: [{ name: 'Bob', frameCount: 4, fps: 8, loop: 'pingpong' }],
});
eq(ase2.meta.frameTags[0].direction, 'pingpong', 'pingpong tag direction');
check('pingpong tag has no repeat field', !('repeat' in ase2.meta.frameTags[0]));

// TexturePacker variant uses the same frameTags and same number of entries.
const tp = buildTexturePackerAtlas({
  imageFilename: 'spritesheet.png',
  spriteName: 'Knight Hero',
  geometry: geom,
  animations: anims,
});
eq(tp.textures[0].frames.length, 18, 'TP frames length');
eq(tp.meta.frameTags, ase.meta.frameTags, 'TP frameTags identical to Aseprite');
check('TP first frame uses underscore-only filename', tp.textures[0].frames[0].filename === 'idle_0');

// Empty trailing cells (when row has fewer frames than cols) must NOT emit
// extra entries — pure regression guard.
const sparse = buildAsepriteAtlas({
  imageFilename: 's.png', spriteName: 'x', geometry: { ...geom, cols: 10, sheetW: 640 },
  animations: [{ name: 'Idle', frameCount: 2, fps: 8, loop: 'forward' }],
});
eq(Object.keys(sparse.frames).length, 2, 'sparse row emits exactly 2 frames, not 10');

console.log('\n--- migration ---');

eq(defaultPlaybackFor('Idle'),   { fps: 6,  loop: 'forward', keyBind: ''     }, 'idle preset');
eq(defaultPlaybackFor('Attack'), { fps: 14, loop: 'once',    keyBind: 'KeyJ' }, 'attack preset');
eq(defaultPlaybackFor('Foo'),    { fps: 8,  loop: 'forward', keyBind: ''     }, 'unknown preset fallback');

// Old character missing fps/loop → migration fills them from preset.
const oldChar = {
  id: 'a', name: 'Old', prompt: '', group: 'Ungrouped',
  artStyle: 'pixel', perspective: 'platformer',
  rawImage: 'data:,', cleanImage: 'data:,',
  animations: [
    { id: '1', name: 'Idle',   customPrompt: '' },
    { id: '2', name: 'Attack', customPrompt: '' },
    { id: '3', name: 'Custom', customPrompt: '' },
  ],
  // also missing frameCounts on purpose
  animRows: [null, null, null], animRowsNoBg: [null, null, null], spriteSheet: null,
};
const migrated = migrateCharacter(oldChar);
eq(migrated.animations[0], { id: '1', name: 'Idle',   customPrompt: '', fps: 6,  loop: 'forward', keyBind: ''      }, 'migrate idle');
eq(migrated.animations[1], { id: '2', name: 'Attack', customPrompt: '', fps: 14, loop: 'once',    keyBind: 'KeyJ'  }, 'migrate attack');
eq(migrated.animations[2], { id: '3', name: 'Custom', customPrompt: '', fps: 8,  loop: 'forward', keyBind: 'Digit1' }, 'migrate custom (auto-assigned digit)');
eq(migrated.frameCounts, [4, 4, 4], 'migrate frameCounts default');
check('schemaVersion stamped', (migrated as any).schemaVersion === CURRENT_SCHEMA);

// Migration is idempotent: running again on the migrated value gives the same value.
const twice = migrateCharacter(migrated);
eq(twice.animations, migrated.animations, 'migration idempotent (animations)');
eq(twice.frameCounts, migrated.frameCounts, 'migration idempotent (frameCounts)');

// User-customised fps must NOT be reset by migration.
const customFps = migrateCharacter({
  ...oldChar,
  animations: [{ id: '1', name: 'Idle', customPrompt: '', fps: 20, loop: 'pingpong' }],
});
eq(customFps.animations[0].fps,  20,         'preserve custom fps');
eq(customFps.animations[0].loop, 'pingpong', 'preserve custom loop');

// fps gets clamped to 1..30
const clamped = migrateCharacter({
  ...oldChar,
  animations: [{ id: '1', name: 'Idle', customPrompt: '', fps: 999, loop: 'forward' }],
});
eq(clamped.animations[0].fps, 30, 'fps clamped to 30');

console.log('\n--- project file ---');

const project = buildProjectFile([migrated], ['Bosses']);
check('project format tag', project.format === PROJECT_FORMAT);
check('project version 1', project.version === 1);
check('project has 1 char', project.characters.length === 1);
check('project has 1 group', project.emptyGroups[0] === 'Bosses');

// Round-trip through JSON.
const text = JSON.stringify(project);
const parsed = parseProjectFile(text);
eq(parsed.characters[0].id, migrated.id, 'roundtrip character id');
eq(parsed.emptyGroups, ['Bosses'], 'roundtrip groups');

// Reject non-project json.
try {
  parseProjectFile(JSON.stringify({ hello: 'world' }));
  check('reject non-project json', false, 'no error thrown');
} catch (e) {
  check('reject non-project json', e instanceof ProjectImportError);
}

// Reject malformed.
try {
  parseProjectFile('not json{');
  check('reject malformed json', false);
} catch (e) {
  check('reject malformed json', e instanceof ProjectImportError);
}

// Reject future version.
try {
  parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, version: 999, characters: [] }));
  check('reject future version', false);
} catch (e) {
  check('reject future version', e instanceof ProjectImportError);
}

// Merge import: existing id must NOT collide.
const charA = { ...migrated, id: 'shared-id' };
const charB = { ...migrated, id: 'shared-id', name: 'Imported' };
const projB = buildProjectFile([charB], []);
const merged = applyImport({ characters: [charA], emptyGroups: [] }, projB, 'merge');
eq(merged.characters.length, 2, 'merge produces 2 chars');
check('merged char b got fresh id', merged.characters[1].id !== 'shared-id');
check('merged char a kept its id', merged.characters[0].id === 'shared-id');

// Replace import wipes the previous state.
const replaced = applyImport(
  { characters: [charA, charA], emptyGroups: ['Old'] },
  projB,
  'replace',
);
eq(replaced.characters.length, 1, 'replace wipes existing');
eq(replaced.emptyGroups, [], 'replace wipes groups');

// Merge unions empty groups.
const projWithGroups = buildProjectFile([], ['Imported A', 'Imported B']);
const mergedGroups = applyImport(
  { characters: [], emptyGroups: ['Existing'] },
  projWithGroups,
  'merge',
);
eq(new Set(mergedGroups.emptyGroups), new Set(['Existing', 'Imported A', 'Imported B']),
   'merge unions group names');

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
