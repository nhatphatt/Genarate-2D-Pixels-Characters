// Seed two mock characters into the engine's IndexedDB.
// One is a CURRENT-shape character (with fps/loop already set).
// The other is an OLD-shape character (no fps/loop, no frameCounts) so we
// also exercise the runtime migration on read.
//
// We use a 1×1 transparent PNG data URL for the cleanImage so the gallery
// renders without needing a real generated sprite.

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';

const seeded = [
  // CURRENT shape — full fields filled in.
  {
    id: 'seed-current-1',
    name: 'Knight Hero',
    prompt: 'Knight hero',
    group: 'Heroes',
    artStyle: 'pixel',
    perspective: 'platformer',
    rawImage: TINY_PNG,
    cleanImage: TINY_PNG,
    animations: [
      { id: 'a-idle',   name: 'Idle',   customPrompt: '', fps: 6,  loop: 'forward' },
      { id: 'a-walk',   name: 'Walk',   customPrompt: '', fps: 10, loop: 'forward' },
      { id: 'a-attack', name: 'Attack', customPrompt: '', fps: 14, loop: 'once'    },
    ],
    frameCounts: [4, 6, 8],
    animRows: [null, null, null],
    animRowsNoBg: [null, null, null],
    spriteSheet: null,
    schemaVersion: 1,
  },
  // OLD shape — missing fps/loop and frameCounts. Should be migrated on read.
  {
    id: 'seed-old-1',
    name: 'Old Pirate',
    prompt: 'Old shape pirate',
    group: 'Ungrouped',
    artStyle: 'pixel',
    perspective: 'platformer',
    rawImage: TINY_PNG,
    cleanImage: TINY_PNG,
    animations: [
      { id: 'b-idle', name: 'Idle',   customPrompt: '' },
      { id: 'b-run',  name: 'Run',    customPrompt: '' },
    ],
    animRows: [null, null],
    animRowsNoBg: [null, null],
    spriteSheet: null,
  },
];

// Returns a Promise that the agent-browser eval will await.
(async function seed() {
  const dbName = 'pixel-engine-v1';
  const storeName = 'kv';

  // Promise wrapper for IDB.
  const open = () => new Promise((res, rej) => {
    const req = indexedDB.open(dbName);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const db = await open();

  // Some browsers may have an existing DB without the store (race-y if app booted
  // first). If so, close + bump version to add the store.
  if (!db.objectStoreNames.contains(storeName)) {
    db.close();
    const ver = db.version + 1;
    await new Promise((res, rej) => {
      const r = indexedDB.open(dbName, ver);
      r.onupgradeneeded = () => r.result.createObjectStore(storeName);
      r.onsuccess = () => { r.result.close(); res(); };
      r.onerror = () => rej(r.error);
    });
  }

  const db2 = await open();
  await new Promise((res, rej) => {
    const tx = db2.transaction(storeName, 'readwrite');
    const st = tx.objectStore(storeName);
    st.put(seeded, 'savedChars');
    st.put(['Heroes'], 'emptyGroups');
    st.put(null, 'activeCharId');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });

  return JSON.stringify({ seeded: seeded.length });
})()
