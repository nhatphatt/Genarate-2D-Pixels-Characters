/**
 * Project file import/export.
 *
 * RFC-002 §G2.
 *
 * A project file is a single self-contained .json with every character,
 * every generated frame (data-URL embedded), and the empty-group list.
 * Re-importing it restores state losslessly.
 *
 * Files are large (data URLs!) — a 7-character project is typically
 * 50–200 MB. That's the right v1 trade-off: no host, no cloud, just a
 * file you can drop on Discord. The UI surfaces the size before download.
 */
import type { SavedCharacter } from '../components/HeroGallery';
import { migrateCharacter } from './storage';

export const PROJECT_FORMAT = 'pixel-engine-project';
export const PROJECT_VERSION = 1 as const;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: string;
  characters: SavedCharacter[];
  emptyGroups: string[];
}

export function buildProjectFile(
  characters: SavedCharacter[],
  emptyGroups: string[],
): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    characters,
    emptyGroups,
  };
}

/**
 * Approximate the on-disk size of the project as it would be exported.
 * Does NOT serialize twice — uses a length proxy on the data URLs and
 * the JSON envelope. Good enough for a "this download is 87 MB" hint.
 */
export function estimateProjectSize(
  characters: SavedCharacter[],
  emptyGroups: string[],
): number {
  let bytes = 256; // envelope
  bytes += JSON.stringify(emptyGroups).length;
  for (const c of characters) {
    // Heavy fields first
    bytes += (c.rawImage?.length ?? 0);
    bytes += (c.cleanImage?.length ?? 0);
    bytes += (c.spriteSheet?.length ?? 0);
    for (const row of c.animRows ?? []) {
      if (!row) continue;
      bytes += (row.rowUrl?.length ?? 0);
      for (const f of row.framesUrls ?? []) bytes += (f?.length ?? 0);
    }
    for (const row of c.animRowsNoBg ?? []) bytes += (row?.length ?? 0);
    // Light fields
    bytes += JSON.stringify({
      id: c.id, name: c.name, prompt: c.prompt, group: c.group,
      artStyle: c.artStyle, perspective: c.perspective,
      animations: c.animations, frameCounts: c.frameCounts,
    }).length;
  }
  return bytes;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Trigger a download of the given project as a single .json file.
 */
export function downloadProjectFile(
  characters: SavedCharacter[],
  emptyGroups: string[],
  filename: string = `pixel-engine-project-${new Date().toISOString().slice(0, 10)}.json`,
): void {
  const project = buildProjectFile(characters, emptyGroups);
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke; some browsers cancel the download if revoked sync.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export class ProjectImportError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ProjectImportError'; }
}

/**
 * Parse a raw JSON string into a validated project. Throws
 * `ProjectImportError` with a human-readable message on any structural
 * problem (wrong format tag, future version, malformed array).
 */
export function parseProjectFile(raw: string): ProjectFile {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectImportError('File is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ProjectImportError('File is empty or not an object.');
  }
  if (parsed.format !== PROJECT_FORMAT) {
    throw new ProjectImportError(
      `Not a Pixel Engine project file (expected format="${PROJECT_FORMAT}", got "${parsed.format ?? 'missing'}").`,
    );
  }
  if (typeof parsed.version !== 'number' || parsed.version > PROJECT_VERSION) {
    throw new ProjectImportError(
      `Project version ${parsed.version} is newer than this app supports (max ${PROJECT_VERSION}).`,
    );
  }
  if (!Array.isArray(parsed.characters)) {
    throw new ProjectImportError('Project is missing the "characters" array.');
  }
  const characters = parsed.characters.map(migrateCharacter);
  const emptyGroups = Array.isArray(parsed.emptyGroups)
    ? parsed.emptyGroups.filter((g: any): g is string => typeof g === 'string')
    : [];
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    characters,
    emptyGroups,
  };
}

export type ImportMode = 'merge' | 'replace';

/**
 * Apply an imported project to the existing in-memory state.
 *
 *   mode='merge'   → append, freshen ids on collision, union groups
 *   mode='replace' → wipe and replace (caller should confirm with user)
 */
export function applyImport(
  current: { characters: SavedCharacter[]; emptyGroups: string[] },
  imported: ProjectFile,
  mode: ImportMode,
): { characters: SavedCharacter[]; emptyGroups: string[] } {
  if (mode === 'replace') {
    return {
      characters: imported.characters,
      emptyGroups: imported.emptyGroups,
    };
  }
  const existingIds = new Set(current.characters.map(c => c.id));
  const merged = imported.characters.map(c =>
    existingIds.has(c.id)
      ? { ...c, id: `${c.id}-import-${Math.random().toString(36).slice(2, 6)}` }
      : c,
  );
  const groupSet = new Set([...current.emptyGroups, ...imported.emptyGroups]);
  return {
    characters: [...current.characters, ...merged],
    emptyGroups: [...groupSet],
  };
}
