/**
 * Sprite-sheet atlas builders.
 *
 * RFC-002 §G3.
 *
 * The compiled sprite sheet is a uniform grid: one row per animation,
 * `cols` cells per row where `cols = max(frameCounts across rows)`. Rows
 * shorter than `cols` leave their trailing cells empty.
 *
 * We emit two atlas formats from one shared metadata struct so they can
 * never drift:
 *
 *   - "aseprite-hash" (the recommended default): the format every modern
 *     2D engine importer reads. Phaser 3 auto-detects, Godot's Aseprite
 *     plugin reads `meta.frameTags` for animation slicing.
 *
 *   - "texturepacker-array": the alternate `frames: []` form used by some
 *     Phaser tutorials and Cocos workflows.
 */

export type AtlasFormat = 'aseprite-hash' | 'texturepacker-array';

export interface AnimationMeta {
  /** Display name, e.g. "Idle". Slugged to lowercase in the export. */
  name: string;
  /** Number of frames actually present in this row (1..10). */
  frameCount: number;
  /** Frames per second for engine playback. */
  fps: number;
  /** Loop behavior. Aseprite has no native "once", so `once` exports as
   *  `forward` plus a vendor `repeat: "1"` field on the tag. */
  loop: 'forward' | 'pingpong' | 'once';
}

export interface SheetGeometry {
  /** Pixel width of one cell. */
  frameW: number;
  /** Pixel height of one cell. */
  frameH: number;
  /** Number of cells per row (= max(frameCounts)). */
  cols: number;
  /** Number of rows. */
  rows: number;
  /** Pixel width of the full sprite sheet image. */
  sheetW: number;
  /** Pixel height of the full sprite sheet image. */
  sheetH: number;
}

export interface BuildAtlasInput {
  imageFilename: string;
  geometry: SheetGeometry;
  animations: AnimationMeta[];
  /** Display name of the source character, used as the sprite prefix in
   *  Aseprite frame keys ("knight idle 0.png"). */
  spriteName: string;
}

export interface AsepriteFrame {
  frame:            { x: number; y: number; w: number; h: number };
  rotated:          boolean;
  trimmed:          boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize:       { w: number; h: number };
  duration:         number;
}

export interface AsepriteFrameTag {
  name:      string;
  from:      number;
  to:        number;
  direction: 'forward' | 'pingpong';
  /** Vendor extension: when the source loop was "once", we set repeat="1".
   *  Importers that don't read it fall back to forward, which is safe. */
  repeat?:   string;
}

export interface AsepriteAtlas {
  frames: Record<string, AsepriteFrame>;
  meta: {
    app:       string;
    version:   string;
    image:     string;
    format:    string;
    size:      { w: number; h: number };
    scale:     string;
    frameTags: AsepriteFrameTag[];
  };
}

export interface TexturePackerFrameEntry extends AsepriteFrame {
  filename: string;
}

export interface TexturePackerAtlas {
  textures: [{
    image:  string;
    format: string;
    size:   { w: number; h: number };
    scale:  number;
    frames: TexturePackerFrameEntry[];
  }];
  meta: {
    app:       string;
    version:   string;
    frameTags: AsepriteFrameTag[];
  };
}

const APP_TAG = 'https://github.com/nhatphatt/Genarate-2D-Pixels-Characters';
const APP_VERSION = '1.0';

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

/** Round-trip a fps value to its Aseprite per-frame duration in ms. */
export function fpsToDuration(fps: number): number {
  const f = Math.max(1, Math.min(60, fps || 1));
  return Math.round(1000 / f);
}

function buildShared(input: BuildAtlasInput) {
  const { geometry, animations, spriteName } = input;
  const { frameW, frameH, cols } = geometry;
  const spriteSlug = slug(spriteName) || 'sprite';

  // Frame indices in Aseprite are GLOBAL across all tags, in the order the
  // tags appear. We keep a running counter and emit one entry per real
  // frame in each row (skipping the empty trailing cells).
  let globalIdx = 0;
  const frameTags: AsepriteFrameTag[] = [];
  const aseFrames: Record<string, AsepriteFrame> = {};
  const tpFrames: TexturePackerFrameEntry[] = [];

  animations.forEach((anim, rowIdx) => {
    const tagFrom = globalIdx;
    const duration = fpsToDuration(anim.fps);
    const tagSlug = slug(anim.name) || `row${rowIdx}`;

    for (let col = 0; col < anim.frameCount && col < cols; col++) {
      const filename = `${spriteSlug} ${tagSlug} ${col}.png`;
      const tpName = `${tagSlug}_${col}`;
      const frame: AsepriteFrame = {
        frame:            { x: col * frameW, y: rowIdx * frameH, w: frameW, h: frameH },
        rotated:          false,
        trimmed:          false,
        spriteSourceSize: { x: 0, y: 0, w: frameW, h: frameH },
        sourceSize:       { w: frameW, h: frameH },
        duration,
      };
      aseFrames[filename] = frame;
      tpFrames.push({ ...frame, filename: tpName });
      globalIdx++;
    }

    const tagTo = globalIdx - 1;
    if (tagTo < tagFrom) return; // row had 0 frames somehow — skip the tag
    const direction: 'forward' | 'pingpong' = anim.loop === 'pingpong' ? 'pingpong' : 'forward';
    const tag: AsepriteFrameTag = { name: tagSlug, from: tagFrom, to: tagTo, direction };
    if (anim.loop === 'once') tag.repeat = '1';
    frameTags.push(tag);
  });

  return { aseFrames, tpFrames, frameTags };
}

export function buildAsepriteAtlas(input: BuildAtlasInput): AsepriteAtlas {
  const { aseFrames, frameTags } = buildShared(input);
  return {
    frames: aseFrames,
    meta: {
      app:       APP_TAG,
      version:   APP_VERSION,
      image:     input.imageFilename,
      format:    'RGBA8888',
      size:      { w: input.geometry.sheetW, h: input.geometry.sheetH },
      scale:     '1',
      frameTags,
    },
  };
}

export function buildTexturePackerAtlas(input: BuildAtlasInput): TexturePackerAtlas {
  const { tpFrames, frameTags } = buildShared(input);
  return {
    textures: [{
      image:  input.imageFilename,
      format: 'RGBA8888',
      size:   { w: input.geometry.sheetW, h: input.geometry.sheetH },
      scale:  1,
      frames: tpFrames,
    }],
    meta: {
      app:       APP_TAG,
      version:   APP_VERSION,
      frameTags,
    },
  };
}

export function buildAtlas(
  input: BuildAtlasInput,
  format: AtlasFormat,
): AsepriteAtlas | TexturePackerAtlas {
  return format === 'aseprite-hash'
    ? buildAsepriteAtlas(input)
    : buildTexturePackerAtlas(input);
}
