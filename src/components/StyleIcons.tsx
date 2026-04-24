/** Thumbnail images and tips for art styles and perspectives. */

export const PERSPECTIVE_IMAGES: Record<string, string> = {
  platformer: '/thumbnails/perspective-platformer.png',
  isometric: '/thumbnails/perspective-isometric.png',
  'top-down': '/thumbnails/perspective-top-down.png',
};

export const STYLE_IMAGES: Record<string, string> = {
  pixel: '/thumbnails/style-pixel.png',
  'detailed-pixel': '/thumbnails/style-detailed-pixel.png',
  chibi: '/thumbnails/style-chibi.png',
  'vector-flat': '/thumbnails/style-vector-flat.png',
  'retro-8bit': '/thumbnails/style-retro-8bit.png',
};

export const PERSPECTIVE_TIPS: Record<string, string> = {
  platformer: 'Classic side-scrolling games like Mario, Hollow Knight. Character shown at 3/4 front angle.',
  isometric: 'Angled top-down view like Diablo, Hades. Character drawn at ~30 degree angle.',
  'top-down': 'Straight down view like old Zelda, Stardew Valley. See character from directly above.',
};

export const STYLE_TIPS: Record<string, string> = {
  pixel: '64x64 canvas, 16 colors max. Classic retro game sprites with clean outlines.',
  'detailed-pixel': '128x128 canvas, 32 colors. More detail and shading while keeping pixel aesthetic.',
  chibi: '96x96 canvas. Big head, tiny body, huge eyes. Cute super-deformed proportions.',
  'vector-flat': '128x128 canvas. Bold outlines, flat solid colors, clean geometric shapes.',
  'retro-8bit': '32x32 canvas, only 4 colors. Extremely chunky, authentic NES-era look.',
};
