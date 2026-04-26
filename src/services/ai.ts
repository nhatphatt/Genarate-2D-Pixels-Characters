import { GoogleGenAI } from "@google/genai";
import { removeBackground } from "../lib/imageUtils";

// Ensure we have access to the AI
const getAiClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  return new GoogleGenAI({ apiKey: key });
};

export type ArtStyle = 'pixel' | 'detailed-pixel' | 'chibi' | 'vector-flat' | 'retro-8bit';

export type Perspective = 'platformer' | 'isometric' | 'top-down';

export const PERSPECTIVES: { id: Perspective; label: string; desc: string; popular?: boolean }[] = [
  { id: 'platformer', label: 'Platformer', desc: 'Side view', popular: true },
  { id: 'isometric', label: 'Isometric', desc: '3/4 angled view' },
  { id: 'top-down', label: 'Top-Down', desc: 'Bird\'s eye view' },
];

function getPerspectiveRules(p: Perspective): string {
  switch (p) {
    case 'isometric':
      return '- Isometric 3/4 view. Character body angled slightly to the right, facing RIGHT. Camera is elevated at ~30 degrees looking down. Character MUST face to the RIGHT side of the image.';
    case 'top-down':
      return '- Top-down bird\'s eye view looking straight down. Character seen from directly above, head visible, foreshortened body. Character MUST be oriented facing toward the RIGHT side of the image.';
    default:
      return '- 3/4 front-facing view angled slightly to the right. Character MUST face to the RIGHT side of the image. Platformer perspective.';
  }
}

export const ART_STYLES: { id: ArtStyle; label: string; desc: string }[] = [
  { id: 'pixel', label: 'Pixel Art', desc: '64x64, 16 colors' },
  { id: 'detailed-pixel', label: 'Detailed Pixel', desc: '128x128, richer palette' },
  { id: 'chibi', label: 'Chibi', desc: 'Cute super-deformed' },
  { id: 'vector-flat', label: 'Vector Flat', desc: 'Clean flat illustration' },
  { id: 'retro-8bit', label: 'Retro 8-bit', desc: 'NES-era low-res' },
];

// ============================================================
// NO-SHADOW RULE — applied to EVERY generation prompt without exception.
// Distinguishes between INTERNAL body shading (allowed) and any form of
// cast/ground/contact/drop shadow on the background (FORBIDDEN).
// ============================================================
const NO_SHADOW_RULE = `ABSOLUTELY FORBIDDEN — ZERO SHADOWS ON BACKGROUND (NON-NEGOTIABLE):
- NO cast shadow under or around the character. NO drop shadow. NO contact shadow. NO ground shadow.
- NO shadow blob, NO shadow puddle, NO oval shadow, NO circular shadow disc beneath the feet.
- NO ambient occlusion darkening the area around the character.
- NO ground patch, NO dirt patch, NO grass tuft, NO rock, NO platform, NO floor tile, NO terrain of any kind under the feet.
- NO darker green, NO lighter green, NO yellow-green, NO blue-green pixels touching or near the character — ONLY pure #00FF00.
- NO glow, NO aura, NO halo, NO outline-glow, NO bloom, NO vignette, NO rim light spilling onto the background.
- NO motion blur trail, NO speed lines, NO dust cloud, NO smoke, NO particles on the background.
- The character appears to FLOAT on a perfectly uniform #00FF00 field with absolutely nothing else in the image.
- Internal body shading (shading ON the character's own skin/clothes/armor) is ALLOWED and expected. But shading must NEVER extend off the character silhouette onto the background.
- The pixel directly below the character's feet, and every pixel within a 30-pixel radius around the character, MUST be exactly #00FF00 — identical to the rest of the background.
- If you are tempted to add a shadow "for grounding the character" — DO NOT. The character must look like it is hovering in pure green void.`;

function getStyleRules(style: ArtStyle): string {
  switch (style) {
    case 'detailed-pixel':
      return `RENDERING TECHNIQUE: Pixel art on a 128x128 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no sub-pixel blending, no smooth gradients.
- Color palette: exactly 32 flat colors maximum. Each color is a single solid hex value with no transparency blending.
- Black (#000000) 1-pixel outline around the entire character silhouette and major body parts.
- Shading: use 2-3 shades per base color (light/mid/dark) ON THE CHARACTER'S BODY ONLY, placed as hard pixel steps — never smooth gradients. Background remains pure #00FF00 with no shading.
- No dithering patterns. No blur. No glow effects. Every pixel edge is a hard 90-degree step.`;
    case 'chibi':
      return `RENDERING TECHNIQUE: Chibi / super-deformed character on a 96x96 pixel canvas.
- Head is exactly 1/2 of total body height. Eyes are large circles taking up 1/3 of the face.
- Body is stubby: short torso, tiny arms and legs, simplified mitten-like hands, round feet.
- Cel-shaded coloring: each surface OF THE CHARACTER has exactly 2 tones (base + shadow), hard edge between them, no gradient. Background remains pure #00FF00 with no shading.
- Black (#000000) 2-pixel outline around the full silhouette. 1-pixel inner lines for details.
- Vibrant saturated colors. No dithering, no anti-aliasing, no pixel-level noise.
- Every pixel must be a deliberate square dot with hard edges.`;
    case 'vector-flat':
      return `RENDERING TECHNIQUE: Flat vector-style 2D illustration on a 128x128 canvas.
- Bold uniform black outline (2-3 pixels thick) around the entire character and all major shapes.
- Solid flat color fills only — zero gradients, zero shading, zero texture. Each shape is ONE solid color.
- Maximum 12 distinct flat colors. No dithering, no noise, no anti-aliasing on edges.
- Geometric simplified shapes: circles, ovals, rectangles. Minimal anatomical detail.
- Clean hard edges everywhere. Style similar to a vector SVG icon rendered at low resolution.
- No pixel-art grid visible — shapes should have smooth curves made of clean anti-aliased edges.`;
    case 'retro-8bit':
      return `RENDERING TECHNIQUE: NES-era 8-bit pixel art on a strict 32x32 pixel canvas.
- EXTREMELY low resolution: the character must fit in 32x32 pixels. Each pixel is large and chunky.
- Color palette: MAXIMUM 4 colors plus transparency. Choose 4 colors and use ONLY those 4.
- No outline — or at most 1-pixel dark border. No anti-aliasing. No sub-pixel rendering.
- Shapes are very blocky and simplified: square head, rectangular body, stick-like limbs.
- No shading, no gradients, no dithering. Every pixel is one of the 4 chosen flat colors.
- The character should look like it belongs on an original 1985 Nintendo NES game.
- Minimal detail: facial features are 1-2 pixels each. Hands and feet are single pixel blocks.`;
    default:
      return `RENDERING TECHNIQUE: Classic pixel art on a 64x64 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no smooth edges, no blur.
- Color palette: exactly 16 flat colors maximum. Each color is a single solid hex value.
- Black (#000000) 1-pixel outline around the entire character silhouette.
- No dithering, no gradients, no glow, no transparency blending.
- Shading: maximum 2 shades per base color ON THE CHARACTER'S BODY ONLY, placed as hard pixel blocks. Background remains pure #00FF00 with no shading.
- Clean retro game sprite aesthetic. Every edge is a hard 90-degree pixel step.`;
  }
}

export async function generateCharacter(prompt: string, style: ArtStyle = 'pixel', perspective: Perspective = 'platformer'): Promise<string> {
  const ai = getAiClient();
  const finalPrompt = `${NO_SHADOW_RULE}

${getStyleRules(style)}

SUBJECT: A single 2D game character sprite: ${prompt}.

VIEW: ${getPerspectiveRules(perspective)}

COMPOSITION RULES:
- Neutral idle stance with arms relaxed at sides.
- Entire character visible head to toe, vertically centered with equal padding on all sides.
- Background is solid flat #00FF00 green. Every background pixel must be exactly #00FF00. Character MUST have a clear black (#000000) 1px outline separating it from the background. No anti-aliasing between character outline and background.
- Output exactly ONE character, nothing else in the image.
- RE-READ the FORBIDDEN list above before drawing. If the image contains ANY shadow, ground patch, glow, or non-#00FF00 pixel touching the character, the output is INVALID.`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          text: finalPrompt,
        },
      ],
    },
  });
  
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated.");
}

export interface BatchCharResult { name: string; dataUrl: string }

/**
 * Generate multiple characters sequentially, passing previously generated
 * images as style/universe reference so AI keeps them consistent.
 */
export async function generateCharacterBatch(
  names: string[],
  context: string,
  style: ArtStyle,
  perspective: Perspective,
  onProgress?: (msg: string, results: BatchCharResult[]) => void,
): Promise<BatchCharResult[]> {
  const ai = getAiClient();
  const results: BatchCharResult[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    onProgress?.(`Generating ${name} (${i + 1}/${names.length})...`, results);

    // Build parts: previous character images as reference + text prompt
    const parts: any[] = [];

    // Attach up to 3 most recent generated characters as style reference
    const refs = results.slice(-3);
    refs.forEach((ref, idx) => {
      const [mimeStr, b64] = ref.dataUrl.split(';base64,');
      const mimeType = mimeStr.replace('data:', '');
      parts.push({ inlineData: { data: b64, mimeType } });
      parts.push({ text: `- Image ${idx + 1}: Previously generated character "${ref.name}" from the same set. Use as style reference.` });
    });

    const charPrompt = context
      ? `${name} from ${context}`
      : name;

    parts.push({ text: `${NO_SHADOW_RULE}

${getStyleRules(style)}

SUBJECT: A single 2D game character sprite: ${charPrompt}.
${refs.length > 0 ? `\nSTYLE REFERENCE: Match the EXACT same rendering technique, pixel size, color palette density, outline thickness, and proportions as the reference image(s) above. The characters belong to the same set and must look like they were drawn by the same artist. IMPORTANT: even if the reference images contain shadows under feet (they should not), you MUST NOT replicate them — follow the FORBIDDEN list at the top.` : ''}

VIEW: ${getPerspectiveRules(perspective)}

COMPOSITION RULES:
- Neutral idle stance with arms relaxed at sides.
- Entire character visible head to toe, vertically centered with equal padding on all sides.
- Background is solid flat #00FF00 green. Every background pixel must be exactly #00FF00. Character MUST have a clear black (#000000) 1px outline separating it from the background. No anti-aliasing between character outline and background.
- Output exactly ONE character, nothing else in the image.
- RE-READ the FORBIDDEN list above before drawing. If the image contains ANY shadow, ground patch, glow, or non-#00FF00 pixel touching the character, the output is INVALID.` });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
    });

    let dataUrl: string | null = null;
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        break;
      }
    }
    if (!dataUrl) throw new Error(`No image generated for "${name}".`);

    results.push({ name, dataUrl });

    // Cooldown between API calls
    if (i < names.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

export interface AnimationRowResult {
  rowUrl: string;
  framesUrls: string[];
}



// ============================================================
// FRAME DESCRIPTIONS — one pose per frame, per animation
// Returns exactly `frameCount` pose descriptions (clamped 1..10).
// ============================================================
function getFrameDescriptions(animName: string, customPrompt: string | undefined, frameCount: number): string[] {
  const n = Math.max(1, Math.min(10, Math.floor(frameCount || 4)));
  const NO_FLIP = "DO NOT flip or mirror. Character MUST face EXACTLY the same direction as the reference. Keep all outfit details, accessories and color patterns on the SAME side as the reference.";

  // Phase descriptors interpolated across n frames so any 1..10 count maps to a smooth action arc.
  // We always include start + end; in-between we sample evenly across an action curve.
  const phaseDescriptor = (i: number, total: number, action: { start: string; mid: string; peak: string; end: string }): string => {
    if (total === 1) return action.peak; // single frame = the most representative pose
    if (i === 0) return action.start;
    if (i === total - 1) return action.end;
    // 0 < t < 1 across in-between frames
    const t = i / (total - 1);
    if (t < 0.4) return action.mid + " (early progression)";
    if (t < 0.65) return action.peak + " (peak)";
    return action.mid + " (recovery)";
  };

  const labelize = (i: number) => `(frame ${i + 1} of ${n})`;

  if (customPrompt && customPrompt.trim()) {
    const action = {
      start: `${customPrompt} — starting pose, beginning of the action`,
      mid:   `${customPrompt} — in progress`,
      peak:  `${customPrompt} — peak action, maximum expression`,
      end:   `${customPrompt} — finishing/recovery, action winding down`,
    };
    return Array.from({ length: n }, (_, i) => `${phaseDescriptor(i, n, action)} ${labelize(i)}. ${NO_FLIP}`);
  }

  let action: { start: string; mid: string; peak: string; end: string };
  switch (animName) {
    case "Idle":
      // ============================================================
      // IDLE — game-standard "breathing loop"
      // Anchor: feet, legs, hips MUST stay PIXEL-IDENTICAL across all frames.
      // Only the chest, shoulders, head and hair sway by 1–2 pixels — this is
      // the classic 4-key breathing cycle: neutral → inhale → peak → exhale.
      // The total silhouette height changes by AT MOST 2 pixels frame-to-frame.
      // Do NOT change pose, do NOT shift weight, do NOT lift any foot off the ground.
      // ============================================================
      action = {
        start: "Idle breathing pose A (neutral rest): character stands relaxed, weight evenly on both feet, BOTH FEET FLAT ON THE GROUND in EXACTLY the same position as the reference image, arms hanging naturally at sides, head level, eyes open looking forward. This is the resting baseline of the breathing loop. Feet, ankles, knees and hips are PIXEL-IDENTICAL to the reference — do NOT move them.",
        mid:   "Idle breathing pose B (inhale start): IDENTICAL to pose A from the hips DOWN — feet, legs, hips do not move at all. The ONLY changes: chest expands by ~1 pixel, shoulders rise by ~1 pixel, head stays level. Arms rest passively at sides. No weight shift. Total silhouette height grows by AT MOST 1 pixel.",
        peak:  "Idle breathing pose C (full inhale, peak): IDENTICAL to pose A from the hips DOWN. Chest fully expanded (+2 pixels max), shoulders raised (+1–2 pixels max), head may rise by 1 pixel only. Arms still relaxed at sides. Body is at its tallest point of the breath cycle but legs/feet/hips are UNCHANGED.",
        end:   "Idle breathing pose D (exhale, returning to rest): IDENTICAL to pose A from the hips DOWN. Chest contracting back down, shoulders lowering, head returning to level. About halfway between pose A and pose C. Loops smoothly back into pose A. Feet/legs/hips PIXEL-IDENTICAL to the reference.",
      };
      break;
    case "Walk":
      action = {
        start: "Walking pose: one leg stepping in front, opposite arm extended in front, back straight, body upright",
        mid:   "Walking pose: legs passing each other mid-stride, body dipping slightly, weight shifting",
        peak:  "Walking pose: opposite leg stepping in front, other arm extended in front",
        end:   "Walking pose: returning toward neutral stance, weight settling",
      };
      break;
    case "Run":
      action = {
        start: "Running pose: one leg in front striking the ground, opposite arm in front, torso leaning slightly",
        mid:   "Running pose: front knee deeply bent, body dipping low, pushing off the ground with back leg",
        peak:  "Running pose: mid-air stride, both feet off ground, legs spread apart, arms pumping",
        end:   "Running pose: opposite leg now in front striking ground, body leaning into the stride",
      };
      break;
    case "Attack":
      action = {
        start: "Attack wind-up pose: one arm pulled back behind the body, stance coiled and ready to strike",
        mid:   "Attack mid-swing pose: arm swinging in the direction the character faces, body rotating into the strike",
        peak:  "Attack impact pose: arm/fist fully extended in the direction the character is facing, maximum reach",
        end:   "Attack recovery pose: arm pulling back to the body, returning to neutral relaxed stance",
      };
      break;
    case "Jump":
      action = {
        start: "Jump preparation pose: crouching down, knees deeply bent, arms pulled down, about to spring up",
        mid:   "Jump launch pose: springing upward, legs pushing off, arms swinging up",
        peak:  "Jump apex pose: at the highest point in air, arms raised above head, legs tucked slightly",
        end:   "Jump landing pose: falling downward, legs extending below, arms out for balance",
      };
      break;
    case "Hurt":
      action = {
        start: "Hurt reaction pose: initial flinch, head tilting back slightly, eyes squinting",
        mid:   "Hurt recoil pose: body recoiling backward, one arm raised defensively in front",
        peak:  "Hurt hunched pose: body hunched forward, tense, pain expression, arms close to body",
        end:   "Hurt holding pose: still hunched and tense, slowly recovering",
      };
      break;
    case "Death":
      action = {
        start: "Death frame: body jolting from impact, still standing upright at full height",
        mid:   "Death frame: knees starting to buckle, body bending forward, losing balance",
        peak:  "Death frame: collapsed onto knees, upper body hunched forward, head drooping down",
        end:   "Death frame: slumped into a crumpled kneeling heap on the ground, compact pose",
      };
      break;
    default:
      action = {
        start: `${animName} — starting pose, beginning of the action`,
        mid:   `${animName} — early progression, action building`,
        peak:  `${animName} — peak of the action, maximum expression`,
        end:   `${animName} — finishing or recovery, action winding down`,
      };
  }

  return Array.from({ length: n }, (_, i) => `${phaseDescriptor(i, n, action)} ${labelize(i)}. ${NO_FLIP}`);
}

// ============================================================
// SINGLE FRAME GENERATION — one API call per frame
// ============================================================
async function generateSingleFrameObj(
  ai: ReturnType<typeof getAiClient>,
  base64Data: string,
  mimeType: string,
  poseDescription: string,
  style: ArtStyle = 'pixel',
  perspective: Perspective = 'platformer',
  animName: string = '',
): Promise<string> {
  // Idle gets an extra lock: the lower body must be PIXEL-IDENTICAL across all
  // 4 frames so that the only motion the player sees is a 1–2px breathing bob
  // on the chest/shoulders/head. Without this lock the AI re-poses the legs
  // every frame and the bottom-center align in spriteCompiler causes the
  // whole sprite to "flicker" up and down in the viewport.
  const idleLock = animName === 'Idle' ? `
IDLE LOCK (CRITICAL — applies to this frame only):
- This is one frame of an IDLE BREATHING LOOP. The character is NOT moving — only breathing.
- Feet, ankles, knees, hips and pelvis MUST be drawn at the EXACT SAME PIXEL POSITIONS as in the reference image. Do NOT lift either foot. Do NOT bend the knees differently. Do NOT shift the weight to one side.
- The character's overall HEIGHT must stay within ±2 pixels of the reference. Do NOT make the character taller or shorter beyond that.
- The character's overall WIDTH and horizontal silhouette must stay within ±1 pixel of the reference.
- Allowed motion: chest expansion/contraction (max 2px), shoulder rise/fall (max 2px), head bob (max 1px), hair/cape sway (max 2px). NOTHING ELSE moves.
- The bounding box of the character must be the SAME SIZE in every frame so the animation does not flicker when looped.
` : '';

  const prompt = `- Image 1: Reference character sprite. Match this EXACTLY.

${NO_SHADOW_RULE}

${getStyleRules(style)}

MANDATORY RULES:
1. Draw EXACTLY ONE character — the same character from the reference image.
2. The character MUST face the EXACT SAME direction as the reference. NEVER flip or mirror.
3. Match the EXACT same rendering technique, pixel size, color palette, proportions, body size, colors, and outfit from the reference.
4. All outfit details, accessories, and color patterns must stay on the SAME SIDE as in the reference.
5. Background must be solid flat #00FF00 green. Character MUST have a clear black 1px outline. No anti-aliasing at edges. No gradients, no text, no ground line. (See FORBIDDEN list above for the full no-shadow rules — this applies to EVERY frame.)
6. Character must be fully visible head to toe, centered with padding.
7. Do NOT change the character's size compared to the reference.
${getPerspectiveRules(perspective)}
${idleLock}
POSE TO DRAW:
${poseDescription}

FINAL CHECK: Verify the character uses the identical rendering technique and color palette as the reference. Verify facing direction matches. Verify the area beneath the feet is pure #00FF00 with NO shadow, NO ground, NO contact patch. If anything differs or any forbidden element is present, fix it.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: prompt },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated for this frame.");
}

// ============================================================
// COMBINE FRAMES — assemble 4 individual frames into a strip
// ============================================================
export function combineFramesIntoStrip(frameDataUrls: string[]): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const images: HTMLImageElement[] = [];
      for (const url of frameDataUrls) {
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('Frame load error'));
          img.src = url;
        });
        images.push(img);
      }

      const count = Math.max(1, images.length);
      const maxW = Math.max(...images.map(i => i.width));
      const maxH = Math.max(...images.map(i => i.height));
      const gap = Math.max(20, Math.floor(maxW * 0.5));

      const canvas = document.createElement('canvas');
      canvas.width = maxW * count + gap * Math.max(0, count - 1);
      canvas.height = maxH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));

      // Transparent canvas — frames already have bg removed
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw each frame bottom-center aligned in its slot
      for (let i = 0; i < count; i++) {
        const x = i * (maxW + gap) + Math.floor((maxW - images[i].width) / 2);
        const y = maxH - images[i].height; // bottom-align
        ctx.drawImage(images[i], x, y);
      }

      resolve(canvas.toDataURL('image/png'));
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// MAIN ENTRY — generates animation row frame by frame
// ============================================================
export async function generateAnimationRow(
  baseCharImage: string,
  animName: string,
  customPrompt?: string,
  onProgress?: (msg: string) => void,
  style: ArtStyle = 'pixel',
  perspective: Perspective = 'platformer',
  frameCount: number = 4,
): Promise<AnimationRowResult> {
  const ai = getAiClient();

  // Clamp frame count to allowed range (1..10)
  const n = Math.max(1, Math.min(10, Math.floor(frameCount || 4)));

  // Extract base64 and mimetype from the reference image
  const mimeTypeMatch = baseCharImage.match(/data:(.*?);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/png";
  const base64Data = baseCharImage.replace(/^data:image\/\w+;base64,/, "");

  // Get pose descriptions for this animation (one per frame)
  const frameDescs = getFrameDescriptions(animName, customPrompt, n);

  // Generate each frame one-by-one for maximum consistency
  const frameDataUrls: string[] = [];

  for (let i = 0; i < n; i++) {
    onProgress?.(`Generating ${animName} frame ${i + 1}/${n}...`);

    const frameUrl = await generateSingleFrameObj(ai, base64Data, mimeType, frameDescs[i], style, perspective, animName);

    // Remove background from this individual frame immediately.
    // This is far more reliable than removing bg from the combined strip,
    // because each frame's green bg is fully connected to its own edges.
    onProgress?.(`Cleaning ${animName} frame ${i + 1}/${n}...`);
    const cleanFrame = await removeBackground(frameUrl, 70);
    frameDataUrls.push(cleanFrame);

    // Cooldown between API calls to avoid rate limits
    if (i < n - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Combine all 4 bg-removed frames into a horizontal strip (transparent gaps)
  onProgress?.(`Combining ${animName} frames into strip...`);
  const rowUrl = await combineFramesIntoStrip(frameDataUrls);
  return { rowUrl, framesUrls: frameDataUrls };
}

// ============================================================
// REGENERATE SINGLE FRAME
// ============================================================
export async function regenerateSingleFrame(
  baseCharImage: string,
  animName: string,
  customPrompt: string | undefined,
  frameIndex: number,
  onProgress?: (msg: string) => void,
  style: ArtStyle = 'pixel',
  perspective: Perspective = 'platformer',
  frameCount: number = 4,
): Promise<string> {
  const ai = getAiClient();
  const n = Math.max(1, Math.min(10, Math.floor(frameCount || 4)));
  const idx = Math.max(0, Math.min(n - 1, frameIndex));
  const [mimeTypeStr, base64Data] = baseCharImage.split(';base64,');
  const mimeType = mimeTypeStr.replace('data:', '');
  const frameDescs = getFrameDescriptions(animName, customPrompt, n);

  onProgress?.(`Regenerating ${animName} frame ${idx + 1}/${n}...`);
  const frameUrl = await generateSingleFrameObj(ai, base64Data, mimeType, frameDescs[idx], style, perspective, animName);

  onProgress?.(`Cleaning frame ${idx + 1}/${n}...`);
  return removeBackground(frameUrl, 70);
}
