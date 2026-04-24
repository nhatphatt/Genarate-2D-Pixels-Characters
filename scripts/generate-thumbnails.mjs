/**
 * Generate style/perspective thumbnails using the EXACT same prompts as the app.
 * Run: node scripts/generate-thumbnails.mjs
 */
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const API_KEY = (() => {
  try { return fs.readFileSync(path.resolve(".env.local"), "utf-8").match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim(); } catch { return process.env.GEMINI_API_KEY; }
})();
if (!API_KEY) { console.error("No API key"); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUT = path.resolve("public/thumbnails");
fs.mkdirSync(OUT, { recursive: true });

const BG = "Background is solid flat #00FF00 green. No shadows, no ground line, no effects, no particles.";
const CHAR = "a medieval knight with a sword and shield, wearing silver armor with a red cape";
const IDLE = "Neutral idle stance with arms relaxed at sides. Entire character visible head to toe, vertically centered with equal padding on all sides.";

// Each item uses the EXACT style/perspective text from ai.ts getStyleRules / getPerspectiveRules
const ITEMS = [
  // ---- ART STYLES (all platformer perspective) ----
  {
    file: "style-pixel.png",
    prompt: `RENDERING TECHNIQUE: Classic pixel art on a 64x64 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no smooth edges, no blur.
- Color palette: exactly 16 flat colors maximum. Each color is a single solid hex value.
- Black (#000000) 1-pixel outline around the entire character silhouette.
- No dithering, no gradients, no glow, no transparency blending.
- Shading: maximum 2 shades per base color, placed as hard pixel blocks.
- Clean retro game sprite aesthetic. Every edge is a hard 90-degree pixel step.

SUBJECT: A single 2D game character sprite: ${CHAR}.
VIEW: 3/4 front-facing view angled slightly to the right. Platformer perspective.
${IDLE}
${BG}`
  },
  {
    file: "style-detailed-pixel.png",
    prompt: `RENDERING TECHNIQUE: Pixel art on a 128x128 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no sub-pixel blending, no smooth gradients.
- Color palette: exactly 32 flat colors maximum. Each color is a single solid hex value with no transparency blending.
- Black (#000000) 1-pixel outline around the entire character silhouette and major body parts.
- Shading: use 2-3 shades per base color (light/mid/dark), placed as hard pixel steps — never smooth gradients.
- No dithering patterns. No blur. No glow effects. Every pixel edge is a hard 90-degree step.

SUBJECT: A single 2D game character sprite: ${CHAR}. More detailed than classic pixel art — visible armor plates, cape folds, sword details.
VIEW: 3/4 front-facing view angled slightly to the right. Platformer perspective.
${IDLE}
${BG}`
  },
  {
    file: "style-chibi.png",
    prompt: `RENDERING TECHNIQUE: Chibi / super-deformed character on a 96x96 pixel canvas.
- Head is exactly 1/2 of total body height. Eyes are large circles taking up 1/3 of the face.
- Body is stubby: short torso, tiny arms and legs, simplified mitten-like hands, round feet.
- Cel-shaded coloring: each surface has exactly 2 tones (base + shadow), hard edge between them, no gradient.
- Black (#000000) 2-pixel outline around the full silhouette. 1-pixel inner lines for details.
- Vibrant saturated colors. No dithering, no anti-aliasing, no pixel-level noise.
- Every pixel must be a deliberate square dot with hard edges.

SUBJECT: A single 2D chibi game character sprite: ${CHAR}. VERY cute with an enormous head compared to tiny body. Big sparkly eyes.
VIEW: 3/4 front-facing view angled slightly to the right. Platformer perspective.
${IDLE}
${BG}`
  },
  {
    file: "style-vector-flat.png",
    prompt: `RENDERING TECHNIQUE: Flat vector-style 2D illustration on a 128x128 canvas.
- Bold uniform black outline (2-3 pixels thick) around the entire character and all major shapes.
- Solid flat color fills only — zero gradients, zero shading, zero texture. Each shape is ONE solid color.
- Maximum 12 distinct flat colors. No dithering, no noise, no anti-aliasing on edges.
- Geometric simplified shapes: circles, ovals, rectangles. Minimal anatomical detail.
- Clean hard edges everywhere. Style similar to a vector SVG icon rendered at low resolution.
- No pixel-art grid visible — shapes should have smooth curves made of clean anti-aliased edges.

SUBJECT: A single 2D game character sprite: ${CHAR}. Simplified geometric shapes, NO pixel art grid, flat colored regions like a vector illustration.
VIEW: 3/4 front-facing view angled slightly to the right. Platformer perspective.
${IDLE}
${BG}`
  },
  {
    file: "style-retro-8bit.png",
    prompt: `RENDERING TECHNIQUE: NES-era 8-bit pixel art on a strict 32x32 pixel canvas.
- EXTREMELY low resolution: the character must fit in 32x32 pixels. Each pixel is large and chunky.
- Color palette: MAXIMUM 4 colors plus transparency. Choose 4 colors and use ONLY those 4.
- No outline — or at most 1-pixel dark border. No anti-aliasing. No sub-pixel rendering.
- Shapes are very blocky and simplified: square head, rectangular body, stick-like limbs.
- No shading, no gradients, no dithering. Every pixel is one of the 4 chosen flat colors.
- The character should look like it belongs on an original 1985 Nintendo NES game.
- Minimal detail: facial features are 1-2 pixels each. Hands and feet are single pixel blocks.

SUBJECT: A single 2D game character sprite: ${CHAR}. EXTREMELY blocky and simple — a few large colored rectangles forming a rough humanoid shape. Like an original NES sprite.
VIEW: 3/4 front-facing view angled slightly to the right. Platformer perspective.
${IDLE}
${BG}`
  },

  // ---- PERSPECTIVES (all pixel art style) ----
  {
    file: "perspective-platformer.png",
    copy: "style-pixel.png"
  },
  {
    file: "perspective-isometric.png",
    prompt: `RENDERING TECHNIQUE: Classic pixel art on a 64x64 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no smooth edges, no blur.
- Color palette: exactly 16 flat colors maximum.
- Black (#000000) 1-pixel outline around the entire character silhouette.

SUBJECT: A single 2D game character sprite: ${CHAR}.
VIEW: Isometric 3/4 view angled slightly to the right. Character drawn at ~30-degree angle from above, as if the camera is elevated looking down at the character. The ground plane is at a diagonal.
${IDLE}
${BG}`
  },
  {
    file: "perspective-top-down.png",
    prompt: `RENDERING TECHNIQUE: Classic pixel art on a 64x64 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no smooth edges, no blur.
- Color palette: exactly 16 flat colors maximum.
- Black (#000000) 1-pixel outline around the entire character silhouette.

SUBJECT: A single 2D game character sprite: ${CHAR}.
VIEW: Top-down bird's eye view looking STRAIGHT DOWN from directly above the character. We see the TOP of the helmet/head, the shoulders from above, the cape spreading out, and the foreshortened body below. This is NOT a side view — we are looking DOWN at the character.
${IDLE}
${BG}`
  },
];

async function generate(item) {
  if (item.copy) {
    fs.copyFileSync(path.join(OUT, item.copy), path.join(OUT, item.file));
    console.log(`${item.file} (copied from ${item.copy})`);
    return;
  }
  console.log(`${item.file}...`);
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: item.prompt }] },
  });
  for (const part of res.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      const buf = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync(path.join(OUT, item.file), buf);
      console.log(`  OK (${(buf.length/1024).toFixed(0)}KB)`);
      return;
    }
  }
  console.error(`  FAILED - no image`);
}

(async () => {
  for (const item of ITEMS) {
    try {
      await generate(item);
      if (!item.copy) await new Promise(r => setTimeout(r, 4000));
    } catch (e) {
      console.error(`  ERROR ${item.file}: ${e.message}`);
    }
  }
  console.log("\nAll done!");
})();
