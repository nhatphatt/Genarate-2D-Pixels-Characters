/**
 * Remove green background from thumbnails — flood fill only, no defringe.
 * Run: node scripts/clean-thumbnails.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = path.resolve('public/thumbnails');
const SIZE = 256;
const TOL = 55;

async function cleanImage(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const px = new Uint8Array(data.buffer, data.byteOffset, data.length);

  const sample = {};
  let maxN = 0, bgR = 0, bgG = 255, bgB = 0;
  const s = (x, y) => {
    const i = (y*w+x)*4, k = `${px[i]>>4},${px[i+1]>>4},${px[i+2]>>4}`;
    if (!sample[k]) sample[k] = { r: px[i], g: px[i+1], b: px[i+2], n: 0 };
    sample[k].n++;
    if (sample[k].n > maxN) { maxN = sample[k].n; bgR = px[i]; bgG = px[i+1]; bgB = px[i+2]; }
  };
  for (let x = 0; x < w; x++) { s(x,0); s(x,h-1); }
  for (let y = 0; y < h; y++) { s(0,y); s(w-1,y); }

  const removed = new Uint8Array(w*h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x,0,x,h-1); }
  for (let y = 0; y < h; y++) { stack.push(0,y,w-1,y); }
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop();
    if (sx<0||sx>=w||sy<0||sy>=h) continue;
    const vi = sy*w+sx;
    if (removed[vi]) continue;
    removed[vi] = 1;
    const i = vi*4;
    if (px[i+3]===0) { for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if(dx||dy) stack.push(sx+dx,sy+dy); continue; }
    const dr=px[i]-bgR, dg=px[i+1]-bgG, db=px[i+2]-bgB;
    if (Math.sqrt(dr*dr+dg*dg+db*db) <= TOL) {
      px[i+3]=0;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if(dx||dy) stack.push(sx+dx,sy+dy);
    } else { removed[vi]=0; }
  }

  let minX=w,minY=h,maxX=0,maxY=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    if (px[(y*w+x)*4+3]>10) { if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; }
  }
  if (maxX<=minX) { console.log(`  ${path.basename(filePath)}: empty`); return; }
  const buf = Buffer.from(px.buffer, px.byteOffset, px.length);
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX-minX+1, height: maxY-minY+1 })
    .resize({ width: SIZE, height: SIZE, fit: 'contain', background: { r:0,g:0,b:0,alpha:0 }, kernel: 'nearest' })
    .png().toFile(filePath);
  console.log(`  ${path.basename(filePath)}: ${(fs.statSync(filePath).size/1024).toFixed(0)}KB`);
}

(async () => {
  for (const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.png'))) {
    try { await cleanImage(path.join(DIR,f)); } catch(e) { console.error(`  ${f}: ${e.message}`); }
  }
  console.log('Done!');
})();
