import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const API_KEY = (() => {
  try { return fs.readFileSync(path.resolve(".env.local"), "utf-8").match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim(); } catch { return process.env.GEMINI_API_KEY; }
})();
const ai = new GoogleGenAI({ apiKey: API_KEY });
const OUT = path.resolve("public/backgrounds");
fs.mkdirSync(OUT, { recursive: true });

const BGS = [
  { file: "forest.png", prompt: "2D pixel art side-scrolling game background: dense magical forest with tall trees, moss, glowing mushrooms, dappled sunlight through canopy. Parallax layers visible. 16-bit SNES style pixel art. Wide landscape format 640x480. Rich green and brown palette. No characters, no UI elements." },
  { file: "sky.png", prompt: "2D pixel art side-scrolling game background: floating sky islands with clouds, blue sky, distant mountains, waterfalls falling into clouds below. 16-bit SNES style pixel art. Wide landscape 640x480. Bright cheerful colors. No characters, no UI." },
  { file: "village.png", prompt: "2D pixel art side-scrolling game background: peaceful medieval village with wooden houses, market stalls, cobblestone path, flowers, blue sky with white clouds. 16-bit SNES style pixel art. Wide landscape 640x480. Warm inviting colors. No characters, no UI." },
];

(async () => {
  for (const bg of BGS) {
    console.log(`${bg.file}...`);
    try {
      const res = await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: { parts: [{ text: bg.prompt }] } });
      for (const part of res.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const buf = Buffer.from(part.inlineData.data, 'base64');
          fs.writeFileSync(path.join(OUT, bg.file), buf);
          console.log(`  OK (${(buf.length/1024).toFixed(0)}KB)`);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 4000));
    } catch (e) { console.error(`  ERROR: ${e.message}`); }
  }
  console.log("Done!");
})();
