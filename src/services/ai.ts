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

export async function generateCharacter(prompt: string): Promise<string> {
  const ai = getAiClient();
  const finalPrompt = `A single 2D pixel art game character: ${prompt}.
Style rules:
- Clean pixel art, 64x64 pixel scale, black 1px outline around the character.
- Limited color palette (max 16 colors), no dithering, no anti-aliasing.
- 3/4 front-facing view angled slightly to the right. Neutral idle stance with arms relaxed at sides.
- Entire character visible head to toe, vertically centered with padding on all sides.
- Background is solid flat #00FF00 green. No shadows, no ground line, no effects.`;
  
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

export function generateIdleRow(baseCharImage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const fw = img.width;
      const fh = img.height;
      const gap = Math.max(20, Math.floor(fw * 0.5)); // large gap between frames
      const canvas = document.createElement('canvas');
      canvas.width = fw * 4 + gap * 3;
      canvas.height = fh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));

      // Frame 1: original, Frame 2: shift down 2px, Frame 3: original, Frame 4: shift up 1px
      const offsets = [0, 2, 0, -1];
      for (let i = 0; i < 4; i++) {
        ctx.drawImage(img, i * (fw + gap), offsets[i]);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load error'));
    img.src = baseCharImage;
  });
}

// ============================================================
// FRAME DESCRIPTIONS — one pose per frame, per animation
// ============================================================
function getFrameDescriptions(animName: string, customPrompt?: string): string[] {
  if (customPrompt && customPrompt.trim()) {
    return [
      `${customPrompt} — starting pose (frame 1 of 4)`,
      `${customPrompt} — in progress (frame 2 of 4)`,
      `${customPrompt} — peak action (frame 3 of 4)`,
      `${customPrompt} — finishing/recovery (frame 4 of 4)`,
    ];
  }

  switch (animName) {
    case "Walk":
      return [
        "Walking pose: right foot stepping forward, left arm extended forward, back straight, body upright.",
        "Walking pose: legs passing each other mid-stride, body dipping slightly, weight shifting.",
        "Walking pose: left foot stepping forward, right arm extended forward, back straight, body upright.",
        "Walking pose: legs passing each other mid-stride, body dipping slightly, returning to start position.",
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
        "Jump preparation pose: crouching down, knees deeply bent, arms pulled down, about to spring up.",
        "Jump launch pose: springing upward, legs pushing off, arms swinging up.",
        "Jump apex pose: at the highest point in air, arms raised above head, legs tucked slightly.",
        "Jump landing pose: falling downward, legs extending below, arms out for balance.",
      ];
    case "Hurt":
      return [
        "Hurt reaction pose: initial flinch, head tilting back slightly, eyes squinting.",
        "Hurt recoil pose: body recoiling backward, one arm raised defensively in front.",
        "Hurt hunched pose: body hunched forward, tense, pain expression, arms close to body.",
        "Hurt holding pose: still hunched and tense, same as previous frame, holding the pain.",
      ];
    case "Death":
      return [
        "Death frame 1: body jolting from impact, still standing upright at full height, pain expression.",
        "Death frame 2: knees starting to buckle, body bending forward, losing balance but still mostly vertical.",
        "Death frame 3: collapsed onto knees, upper body hunched forward, head drooping down.",
        "Death frame 4: slumped into a crumpled kneeling heap on the ground. NOT lying flat horizontal. Compact pose.",
      ];
    default:
      return [
        `${animName} — starting pose, beginning of the action.`,
        `${animName} — early progression, action building.`,
        `${animName} — peak of the action, maximum expression.`,
        `${animName} — finishing or recovery, action winding down.`,
      ];
  }
}

// ============================================================
// SINGLE FRAME GENERATION — one API call per frame
// ============================================================
async function generateSingleFrame(
  ai: ReturnType<typeof getAiClient>,
  base64Data: string,
  mimeType: string,
  poseDescription: string,
): Promise<string> {
  const prompt = `Look at the reference character image carefully. Generate this EXACT SAME character in a new pose.

MANDATORY RULES:
1. Draw EXACTLY ONE character — the same character from the reference.
2. The character MUST face the EXACT SAME direction as the reference image. If reference faces right, this pose faces right. If reference faces left, this pose faces left. NEVER flip or mirror.
3. Use the EXACT same pixel art style, pixel scale, proportions, body size, colors, and outfit.
4. All outfit details, accessories, and color patterns must stay on the SAME SIDE as in the reference. If a stripe or accessory is on the character's left side in the reference, it must remain on the left side.
5. Background must be solid flat #00FF00 green. No gradients, no shadows, no effects, no sparkles, no text, no ground line.
6. Character must be fully visible head to toe, centered with padding.
7. Do NOT shrink or enlarge the character compared to the reference.

POSE TO DRAW:
${poseDescription}

FINAL CHECK: Before outputting, verify the character faces the same direction as the reference and outfit details are on the correct sides. If anything is mirrored, fix it.`;

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
function combineFramesIntoStrip(frameDataUrls: string[]): Promise<string> {
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
): Promise<string> {
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

    const frameUrl = await generateSingleFrame(ai, base64Data, mimeType, frameDescs[i]);

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
  return combineFramesIntoStrip(frameDataUrls);
}
