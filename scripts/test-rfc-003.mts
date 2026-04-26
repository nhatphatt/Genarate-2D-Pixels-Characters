/**
 * Manual logic checks for RFC-003 deliverables.
 *
 * Run with:  npx tsx scripts/test-rfc-003.mts
 */
import {
  migrateCharacter,
  defaultPlaybackFor,
  isLocomotionName,
  RESERVED_KEY_CODES,
} from '../src/lib/storage.ts';
import { formatKeyCode } from '../src/components/HotkeyChip.tsx';

let failed = 0;
function check(name: string, cond: any, detail?: string) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}
function eq<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

console.log('--- defaultPlaybackFor keyBinds ---');
eq(defaultPlaybackFor('Idle').keyBind,   '',     'Idle has empty keyBind (locomotion-ish, auto)');
eq(defaultPlaybackFor('Walk').keyBind,   '',     'Walk uses arrows, no single keyBind');
eq(defaultPlaybackFor('Run').keyBind,    '',     'Run uses arrows + Shift');
eq(defaultPlaybackFor('Jump').keyBind,   '',     'Jump uses Space/W');
eq(defaultPlaybackFor('Attack').keyBind, 'KeyJ', 'Attack default = KeyJ');
eq(defaultPlaybackFor('Hurt').keyBind,   'KeyH', 'Hurt default = KeyH');
eq(defaultPlaybackFor('Death').keyBind,  'KeyK', 'Death default = KeyK');
eq(defaultPlaybackFor('Cast').keyBind,   '',     'Unknown name returns empty (filled later by digit pass)');

console.log('\n--- isLocomotionName ---');
check('idle is locomotion', isLocomotionName('Idle'));
check('walk is locomotion', isLocomotionName('Walk'));
check('run is locomotion',  isLocomotionName('Run'));
check('jump is locomotion', isLocomotionName('Jump'));
check('attack is NOT locomotion', !isLocomotionName('Attack'));
check('cast is NOT locomotion',   !isLocomotionName('Cast Spell'));

console.log('\n--- reserved keys ---');
['ArrowLeft', 'ArrowRight', 'KeyW', 'Space', 'ShiftLeft'].forEach(k =>
  check(`${k} is reserved`, RESERVED_KEY_CODES.has(k)),
);
['KeyJ', 'KeyL', 'Digit1', 'Backquote'].forEach(k =>
  check(`${k} is NOT reserved`, !RESERVED_KEY_CODES.has(k)),
);

console.log('\n--- formatKeyCode ---');
eq(formatKeyCode(''),          '—',     'empty → em dash');
eq(formatKeyCode('KeyJ'),      'J',     'KeyJ → J');
eq(formatKeyCode('Digit1'),    '1',     'Digit1 → 1');
eq(formatKeyCode('Numpad5'),   'Num 5', 'Numpad5 → Num 5');
eq(formatKeyCode('Space'),     'Space', 'Space passes through');
eq(formatKeyCode('Backquote'), '`',     'Backquote → `');
eq(formatKeyCode('BracketLeft'), '[',   'BracketLeft → [');
eq(formatKeyCode('Slash'),     '/',     'Slash → /');

console.log('\n--- migration with custom rows ---');

const charWithCustoms = {
  id: 'c1', name: 'Mage', prompt: '', group: 'X',
  artStyle: 'pixel', perspective: 'platformer',
  rawImage: 'data:,', cleanImage: 'data:,',
  animations: [
    { id: '1', name: 'Idle',     customPrompt: '' },
    { id: '2', name: 'Walk',     customPrompt: '' },
    { id: '3', name: 'Attack',   customPrompt: '' },
    { id: '4', name: 'Cast',     customPrompt: '' },  // custom → Digit1
    { id: '5', name: 'Block',    customPrompt: '' },  // custom → Digit2
    { id: '6', name: 'Roll',     customPrompt: '' },  // custom → Digit3
  ],
  animRows: Array(6).fill(null), animRowsNoBg: Array(6).fill(null), spriteSheet: null,
};
const migrated = migrateCharacter(charWithCustoms);
eq(migrated.animations.map(a => a.keyBind),
   ['', '', 'KeyJ', 'Digit1', 'Digit2', 'Digit3'],
   'custom rows get sequential digits, presets are preserved');

// Migration is idempotent on the keyBind layer too.
const twice = migrateCharacter(migrated);
eq(twice.animations.map(a => a.keyBind),
   migrated.animations.map(a => a.keyBind),
   'keyBind migration idempotent');

// Explicit user keyBind survives migration.
const userBound = migrateCharacter({
  ...charWithCustoms,
  animations: [
    { id: '1', name: 'Attack', customPrompt: '', keyBind: 'KeyL' },
    { id: '2', name: 'Cast',   customPrompt: '', keyBind: 'KeyM' },
  ],
});
eq(userBound.animations.map(a => a.keyBind),
   ['KeyL', 'KeyM'],
   'user-set keyBinds preserved verbatim');

// Empty-string keyBind also survives (user explicitly cleared it).
const explicitlyEmpty = migrateCharacter({
  ...charWithCustoms,
  animations: [
    { id: '1', name: 'Cast', customPrompt: '', keyBind: '' },
    { id: '2', name: 'Roll', customPrompt: '' },  // missing → Digit1
  ],
});
eq(explicitlyEmpty.animations.map(a => a.keyBind),
   ['', 'Digit1'],
   'explicit empty stays empty; missing gets fresh digit not colliding with empty');

// Digit collision avoidance: if user pinned Digit1 manually, the custom row
// gets Digit2.
const collide = migrateCharacter({
  ...charWithCustoms,
  animations: [
    { id: '1', name: 'Cast', customPrompt: '', keyBind: 'Digit1' },  // user pinned
    { id: '2', name: 'Roll', customPrompt: '' },  // missing → Digit2
    { id: '3', name: 'Heal', customPrompt: '' },  // missing → Digit3
  ],
});
eq(collide.animations.map(a => a.keyBind),
   ['Digit1', 'Digit2', 'Digit3'],
   'fresh digit assignment skips already-claimed digits');

// More than 9 custom rows: the 10th gets empty string fallback.
const many = migrateCharacter({
  ...charWithCustoms,
  animations: Array.from({ length: 11 }, (_, i) => ({
    id: String(i), name: `Skill${i}`, customPrompt: '',
  })),
});
const binds = many.animations.map(a => a.keyBind);
eq(binds.slice(0, 9), ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9'],
   'first 9 get Digit1..Digit9');
eq(binds.slice(9), ['', ''], '10th and 11th fall back to empty');

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed} failure(s)`);
process.exit(failed === 0 ? 0 : 1);
