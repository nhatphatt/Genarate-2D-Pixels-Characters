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

function getStyleRules(style: ArtStyle): string {
  switch (style) {
    case 'detailed-pixel':
      return `RENDERING TECHNIQUE: Pixel art on a 128x128 pixel canvas.
- Every pixel must be a deliberate square dot — no anti-aliasing, no sub-pixel blending, no smooth gradients.
- Color palette: exactly 32 flat colors maximum. Each color is a single solid hex value with no transparency blending.
- Black (#000000) 1-pixel outline around the entire character silhouette and major body parts.
- Shading: use 2-3 shades per base color (light/mid/dark), placed as hard pixel steps — never smooth gradients.
- No dithering patterns. No blur. No glow effects. Every pixel edge is a hard 90-degree step.`;
    case 'chibi':
      return `RENDERING TECHNIQUE: Chibi / super-deformed character on a 96x96 pixel canvas.
- Head is exactly 1/2 of total body height. Eyes are large circles taking up 1/3 of the face.
- Body is stubby: short torso, tiny arms and legs, simplified mitten-like hands, round feet.
- Cel-shaded coloring: each surface has exactly 2 tones (base + shadow), hard edge between them, no gradient.
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
- Shading: maximum 2 shades per base color, placed as hard pixel blocks.
- Clean retro game sprite aesthetic. Every edge is a hard 90-degree pixel step.`;
  }
}

export async function generateCharacter(prompt: string, style: ArtStyle = 'pixel', perspective: Perspective = 'platformer'): Promise<string> {
  const ai = getAiClient();
  const finalPrompt = `${getStyleRules(style)}

SUBJECT: A single 2D game character sprite: ${prompt}.

VIEW: ${getPerspectiveRules(perspective)}

COMPOSITION RULES:
- Neutral idle stance with arms relaxed at sides.
- Entire character visible head to toe, vertically centered with equal padding on all sides.
- Background is solid flat #00FF00 green. Every background pixel must be exactly #00FF00. Character MUST have a clear black (#000000) 1px outline separating it from the background. No anti-aliasing between character outline and background. CRITICAL: NO shadow blob under the character's feet. NO ground circle. NO glow. NO darker-green area anywhere touching the character. The area directly below the character's feet must be the EXACT same #00FF00 as the rest of the background.
- Output exactly ONE character, nothing else in the image.`;
  
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

    parts.push({ text: `${getStyleRules(style)}

SUBJECT: A single 2D game character sprite: ${charPrompt}.
${refs.length > 0 ? `\nSTYLE REFERENCE: Match the EXACT same rendering technique, pixel size, color palette density, outline thickness, and proportions as the reference image(s) above. The characters belong to the same set and must look like they were drawn by the same artist.` : ''}

VIEW: ${getPerspectiveRules(perspective)}

COMPOSITION RULES:
- Neutral idle stance with arms relaxed at sides.
- Entire character visible head to toe, vertically centered with equal padding on all sides.
- Background is solid flat #00FF00 green. Every background pixel must be exactly #00FF00. Character MUST have a clear black (#000000) 1px outline separating it from the background. No anti-aliasing between character outline and background. CRITICAL: NO shadow blob under the character's feet. NO ground circle. NO glow. NO darker-green area anywhere touching the character. The area directly below the character's feet must be the EXACT same #00FF00 as the rest of the background.
- Output exactly ONE character, nothing else in the image.` });

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
// ============================================================
function getFrameDescriptions(animName: string, customPrompt?: string): string[] {
  if (customPrompt && customPrompt.trim()) {
    return [
      `${customPrompt} — starting pose (frame 1 of 4). DO NOT flip or mirror.`,
      `${customPrompt} — in progress (frame 2 of 4). Character faces SAME direction as reference. Keep outfit details on the SAME side.`,
      `${customPrompt} — peak action (frame 3 of 4). DO NOT flip. Character must face EXACTLY the same way.`,
      `${customPrompt} — finishing/recovery (frame 4 of 4). Keep the same facing direction as all other frames. DO NOT mirror.`,
    ];
  }

  switch (animName) {
    case "Idle":
      return [
        "Idle pose: standing perfectly still, relaxed neutral stance, normal breathing. DO NOT flip or mirror.",
        "Idle pose: chest slightly expanded, shoulders slightly raised (breathing in). Character faces EXACTLY the SAME direction as reference.",
        "Idle pose: peak of breath, body slightly taller, very subtle movement. Keep outfit details on the SAME side.",
        "Idle pose: exhaling, shoulders relaxing back down to start. DO NOT flip. Character must face EXACTLY the same way.",
      ];
    case "Walk":
      return [
        "Walking pose: one leg stepping in front, opposite arm extended in front, back straight, body upright. DO NOT flip or mirror.",
        "Walking pose: legs passing each other mid-stride, body dipping slightly, weight shifting. Keep outfit details on the SAME side as reference.",
        "Walking pose: opposite leg stepping in front, other arm extended in front. Character faces SAME direction as reference.",
        "Walking pose: legs passing each other mid-stride, body dipping slightly. DO NOT flip. Keep the same facing direction.",
      ];
    case "Run":
      return [
        "Running pose: one leg in front striking the ground, opposite arm in front, torso leaning slightly. DO NOT flip or mirror the character.",
        "Running pose: front knee deeply bent, body dipping low, pushing off the ground with back leg. Keep outfit details on the same side as the reference.",
        "Running pose: mid-air stride, both feet off ground, legs spread apart, arms pumping. Character must face the SAME direction as the reference — do NOT mirror.",
        "Running pose: opposite leg now in front striking ground, body leaning into the stride. Keep the same facing direction as all other frames. DO NOT flip.",
      ];
    case "Attack":
      return [
        "Attack wind-up pose: one arm pulled back behind the body, stance coiled and ready to strike. Character faces same direction as reference.",
        "Attack mid-swing pose: arm swinging in the direction the character faces, body rotating into the punch/strike. DO NOT flip or mirror the character.",
        "Attack impact pose: arm/fist fully extended in the direction the character is facing, maximum reach. Keep the character facing the EXACT same direction as the reference image.",
        "Attack recovery pose: arm pulling back to the body, returning to neutral relaxed stance. Same facing direction as all other frames. DO NOT mirror.",
      ];
    case "Jump":
      return [
        "Jump preparation pose: crouching down, knees deeply bent, arms pulled down, about to spring up. DO NOT flip or mirror the character.",
        "Jump launch pose: springing upward, legs pushing off, arms swinging up. Keep outfit details on the SAME side as reference.",
        "Jump apex pose: at the highest point in air, arms raised above head, legs tucked slightly. Character faces SAME direction as reference.",
        "Jump landing pose: falling downward, legs extending below, arms out for balance. DO NOT flip. Keep the same facing direction.",
      ];
    case "Hurt":
      return [
        "Hurt reaction pose: initial flinch, head tilting back slightly, eyes squinting. DO NOT flip or mirror.",
        "Hurt recoil pose: body recoiling backward, one arm raised defensively in front. Keep character facing SAME direction as reference.",
        "Hurt hunched pose: body hunched forward, tense, pain expression, arms close to body. Keep outfit details on the SAME side.",
        "Hurt holding pose: still hunched and tense, same as previous frame. DO NOT flip. Character must face EXACTLY the same way.",
      ];
    case "Death":
      return [
        "Death frame 1: body jolting from impact, still standing upright at full height. DO NOT flip or mirror.",
        "Death frame 2: knees starting to buckle, body bending forward, losing balance. Character faces SAME direction as reference.",
        "Death frame 3: collapsed onto knees, upper body hunched forward, head drooping down. Keep outfit details on the SAME side.",
        "Death frame 4: slumped into a crumpled kneeling heap on the ground. Compact pose. DO NOT flip. Character must face EXACTLY the same way.",
      ];
    default:
      return [
        `${animName} — starting pose, beginning of the action. DO NOT flip or mirror.`,
        `${animName} — early progression, action building. Character faces SAME direction as reference.`,
        `${animName} — peak of the action, maximum expression. Keep outfit details on the SAME side.`,
        `${animName} — finishing or recovery, action winding down. DO NOT flip. Character must face EXACTLY the same way.`,
      ];
  }
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
): Promise<string> {
  const prompt = `- Image 1: Reference character sprite. Match this EXACTLY.

${getStyleRules(style)}

MANDATORY RULES:
1. Draw EXACTLY ONE character — the same character from the reference image.
2. The character MUST face the EXACT SAME direction as the reference. NEVER flip or mirror.
3. Match the EXACT same rendering technique, pixel size, color palette, proportions, body size, colors, and outfit from the reference.
4. All outfit details, accessories, and color patterns must stay on the SAME SIDE as in the reference.
5. Background must be solid flat #00FF00 green. Character MUST have a clear black 1px outline. No anti-aliasing at edges. NO shadow blob under feet. NO ground circle. NO darker-green area anywhere. No gradients, no shadows, no effects, no text, no ground line.
6. Character must be fully visible head to toe, centered with padding.
7. Do NOT change the character's size compared to the reference.
${getPerspectiveRules(perspective)}

POSE TO DRAW:
${poseDescription}

FINAL CHECK: Verify the character uses the identical rendering technique and color palette as the reference. Verify facing direction matches. If anything differs, fix it.`;

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

      const maxW = Math.max(...images.map(i => i.width));
      const maxH = Math.max(...images.map(i => i.height));
      const gap = Math.max(20, Math.floor(maxW * 0.5));

      const canvas = document.createElement('canvas');
      canvas.width = maxW * 4 + gap * 3;
      canvas.height = maxH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));

      // Transparent canvas — frames already have bg removed
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw each frame bottom-center aligned in its slot
      for (let i = 0; i < images.length; i++) {
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
): Promise<AnimationRowResult> {
  const ai = getAiClient();

  // Extract base64 and mimetype from the reference image
  const mimeTypeMatch = baseCharImage.match(/data:(.*?);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/png";
  const base64Data = baseCharImage.replace(/^data:image\/\w+;base64,/, "");

  // Get the 4 individual pose descriptions for this animation
  const frameDescs = getFrameDescriptions(animName, customPrompt);

  // Generate each frame one-by-one for maximum consistency
  const frameDataUrls: string[] = [];

  for (let i = 0; i < 4; i++) {
    onProgress?.(`Generating ${animName} frame ${i + 1}/4...`);

    const frameUrl = await generateSingleFrameObj(ai, base64Data, mimeType, frameDescs[i], style, perspective);

    // Remove background from this individual frame immediately.
    // This is far more reliable than removing bg from the combined strip,
    // because each frame's green bg is fully connected to its own edges.
    onProgress?.(`Cleaning ${animName} frame ${i + 1}/4...`);
    const cleanFrame = await removeBackground(frameUrl, 70);
    frameDataUrls.push(cleanFrame);

    // Cooldown between API calls to avoid rate limits
    if (i < 3) {
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
): Promise<string> {
  const ai = getAiClient();
  const [mimeTypeStr, base64Data] = baseCharImage.split(';base64,');
  const mimeType = mimeTypeStr.replace('data:', '');
  const frameDescs = getFrameDescriptions(animName, customPrompt);
  
  onProgress?.(`Regenerating ${animName} frame ${frameIndex + 1}...`);
  const frameUrl = await generateSingleFrameObj(ai, base64Data, mimeType, frameDescs[frameIndex], style, perspective);
  
  onProgress?.(`Cleaning frame ${frameIndex + 1}...`);
  return removeBackground(frameUrl, 70);
}
