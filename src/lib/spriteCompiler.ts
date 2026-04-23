export async function compileSpriteSheet(rowImagesBase64: (string | null)[], framesPerRow = 4): Promise<string> {
  const images: HTMLImageElement[] = [];
  
  for (let i = 0; i < rowImagesBase64.length; i++) {
      const b64 = rowImagesBase64[i];
      if (b64) {
          const img = new Image();
          await new Promise((res, rej) => {
              img.onload = res;
              img.onerror = rej;
              img.src = b64;
          });
          images[i] = img;
      }
  }

  if (images.length === 0) throw new Error("No images to compile");

  // Helper: split a horizontal sprite strip into frames by finding vertical gaps
  const extractFramesFromImage = (img: HTMLImageElement, expectedFrames: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const data = imgData.data;
      const w = img.width;
      const h = img.height;

      // Build column occupancy: for each x, is there any meaningful (non-transparent, non-black) pixel?
      const colHasPixel = new Uint8Array(w);
      for (let x = 0; x < w; x++) {
          for (let y = 0; y < h; y++) {
              const idx = (y * w + x) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
              // Skip transparent and near-black pixels (AI border artifacts)
              if (a > 10 && (r + g + b) > 30) { colHasPixel[x] = 1; break; }
          }
      }

      // Find contiguous horizontal spans of occupied columns
      const spans: { startX: number, endX: number }[] = [];
      let inSpan = false;
      let spanStart = 0;
      for (let x = 0; x < w; x++) {
          if (colHasPixel[x] && !inSpan) { inSpan = true; spanStart = x; }
          else if (!colHasPixel[x] && inSpan) { spans.push({ startX: spanStart, endX: x - 1 }); inSpan = false; }
      }
      if (inSpan) spans.push({ startX: spanStart, endX: w - 1 });

      // If gap detection didn't find enough separate frames, try smarter strategies
      let selected: { startX: number, endX: number }[];
      if (spans.length >= expectedFrames) {
          selected = spans.slice(0, expectedFrames);
      } else if (spans.length > 0 && spans.length < expectedFrames) {
          // Not enough gaps detected — frames may be touching.
          // Strategy: try to split the widest span(s) by finding columns with
          // the fewest occupied pixels (weak points / thin connections).
          const allSpans = [...spans];
          
          while (allSpans.length < expectedFrames) {
              // Find the widest span to split
              let widestIdx = 0;
              let widestW = 0;
              for (let si = 0; si < allSpans.length; si++) {
                  const sw = allSpans[si].endX - allSpans[si].startX + 1;
                  if (sw > widestW) { widestW = sw; widestIdx = si; }
              }
              
              const span = allSpans[widestIdx];
              const spanW = span.endX - span.startX + 1;
              
              // Count occupied pixels in each column within this span
              const colOccupancy: number[] = [];
              for (let x = span.startX; x <= span.endX; x++) {
                  let count = 0;
                  for (let y = 0; y < h; y++) {
                      const idx = (y * w + x) * 4;
                      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
                      if (a > 10 && (r + g + b) > 30) count++;
                  }
                  colOccupancy.push(count);
              }
              
              // Find the best split point — column with minimum occupancy in
              // the middle 60% of the span (avoid splitting near edges)
              const margin = Math.floor(spanW * 0.2);
              let bestSplitLocal = Math.floor(spanW / 2);
              let bestOcc = Infinity;
              for (let i = margin; i < spanW - margin; i++) {
                  // Use a small window (3 columns) to find smooth split points
                  let windowOcc = colOccupancy[i];
                  if (i > 0) windowOcc += colOccupancy[i - 1];
                  if (i < spanW - 1) windowOcc += colOccupancy[i + 1];
                  if (windowOcc < bestOcc) {
                      bestOcc = windowOcc;
                      bestSplitLocal = i;
                  }
              }
              
              const splitX = span.startX + bestSplitLocal;
              const left = { startX: span.startX, endX: splitX - 1 };
              const right = { startX: splitX + 1, endX: span.endX };
              allSpans.splice(widestIdx, 1, left, right);
          }
          
          // Sort by x position and take the expected number
          allSpans.sort((a, b) => a.startX - b.startX);
          selected = allSpans.slice(0, expectedFrames);
      } else {
          // Check if image is roughly square (AI made a grid instead of a strip)
          const isGrid = w < h * 1.5;
          if (isGrid && expectedFrames === 4) {
              // Assume 2x2 grid: split into 4 quadrants
              const halfW = Math.floor(w / 2);
              const halfH = Math.floor(h / 2);
              const quadrants = [
                  { sx: 0, sy: 0 }, { sx: halfW, sy: 0 },
                  { sx: 0, sy: halfH }, { sx: halfW, sy: halfH }
              ];
              return quadrants.map(q => {
                  // Trim each quadrant
                  let minX = halfW, maxX = 0, minY = halfH, maxY = 0;
                  for (let y = q.sy; y < q.sy + halfH && y < h; y++) {
                      for (let x = q.sx; x < q.sx + halfW && x < w; x++) {
                          const idx = (y * w + x) * 4;
                          const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
                          if (a > 10 && (r + g + b) > 30) {
                              if (x - q.sx < minX) minX = x - q.sx;
                              if (x - q.sx > maxX) maxX = x - q.sx;
                              if (y - q.sy < minY) minY = y - q.sy;
                              if (y - q.sy > maxY) maxY = y - q.sy;
                          }
                      }
                  }
                  if (minX > maxX) { minX = 0; maxX = halfW - 1; minY = 0; maxY = halfH - 1; }
                  const fw = maxX - minX + 1, fh = maxY - minY + 1;
                  const fc = document.createElement('canvas');
                  fc.width = fw; fc.height = fh;
                  const fctx = fc.getContext('2d')!;
                  fctx.drawImage(canvas, q.sx + minX, q.sy + minY, fw, fh, 0, 0, fw, fh);
                  return { canvas: fc, w: fw, h: fh };
              });
          }
          // Last resort: equal-width horizontal slicing
          const sliceW = Math.floor(w / expectedFrames);
          selected = [];
          for (let i = 0; i < expectedFrames; i++) {
              selected.push({
                  startX: i * sliceW,
                  endX: i === expectedFrames - 1 ? w - 1 : (i + 1) * sliceW - 1
              });
          }
      }

      // Extract each span as a frame, trimming vertical whitespace
      return selected.map(span => {
          const sw = span.endX - span.startX + 1;
          // Find vertical bounds within this span
          let minY = h, maxY = 0;
          for (let y = 0; y < h; y++) {
              for (let x = span.startX; x <= span.endX; x++) {
                  const idx = (y * w + x) * 4;
                  const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
                  if (a > 10 && (r + g + b) > 30) {
                      if (y < minY) minY = y;
                      if (y > maxY) maxY = y;
                  }
              }
          }
          if (minY > maxY) { minY = 0; maxY = h - 1; }
          const sh = maxY - minY + 1;

          const fc = document.createElement('canvas');
          fc.width = sw;
          fc.height = sh;
          const fctx = fc.getContext('2d')!;
          fctx.drawImage(canvas, span.startX, minY, sw, sh, 0, 0, sw, sh);
          return { canvas: fc, w: sw, h: sh };
      });
  };

  const extractedRows: { canvas: HTMLCanvasElement, w: number, h: number }[][] = [];
  let globalMaxWidth = 0;
  let globalMaxHeight = 0;

  for (let i = 0; i < rowImagesBase64.length; i++) {
      if (images[i]) {
          const frames = extractFramesFromImage(images[i], framesPerRow);
          extractedRows[i] = frames;
          
          frames.forEach(f => {
              if (f.w > globalMaxWidth) globalMaxWidth = f.w;
              if (f.h > globalMaxHeight) globalMaxHeight = f.h;
          });
      } else {
          extractedRows[i] = [];
      }
  }

  // === AUTO-FLIP DETECTION (Rule 4 enforcement) ===
  // Detects mirrored frames by comparing COLOR PATTERNS of left vs right halves.
  // COM-based detection fails for roughly symmetric characters — a character can
  // have the same shape when flipped but different outfit colors on each side.
  // This method catches cases like "red stripe moved to opposite side".
  const getColorSignature = (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const thirdW = Math.floor(canvas.width / 3);

      let lR = 0, lG = 0, lB = 0, lN = 0;
      let rR = 0, rG = 0, rB = 0, rN = 0;

      for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
              const idx = (y * canvas.width + x) * 4;
              const a = data[idx + 3], r = data[idx], g = data[idx + 1], b = data[idx + 2];
              if (a <= 10 || (r + g + b) <= 30) continue;

              if (x < thirdW) {
                  lR += r; lG += g; lB += b; lN++;
              } else if (x >= canvas.width - thirdW) {
                  rR += r; rG += g; rB += b; rN++;
              }
          }
      }
      if (lN === 0 || rN === 0) return null;
      return {
          lR: lR / lN, lG: lG / lN, lB: lB / lN,
          rR: rR / rN, rG: rG / rN, rB: rB / rN,
      };
  };

  const colorDist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
      Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

  for (let i = 0; i < extractedRows.length; i++) {
      const frames = extractedRows[i];
      if (frames.length < 2) continue;

      const refSig = getColorSignature(frames[0].canvas);
      if (!refSig) continue;

      // Check if frame 0 itself has meaningful left/right color asymmetry
      const refAsymmetry = colorDist(refSig.lR, refSig.lG, refSig.lB, refSig.rR, refSig.rG, refSig.rB);
      if (refAsymmetry < 15) continue; // Too symmetric to detect flips reliably

      for (let f = 1; f < frames.length; f++) {
          const sig = getColorSignature(frames[f].canvas);
          if (!sig) continue;

          // Normal orientation: frame's left matches ref's left, frame's right matches ref's right
          const normalDist = colorDist(sig.lR, sig.lG, sig.lB, refSig.lR, refSig.lG, refSig.lB)
                           + colorDist(sig.rR, sig.rG, sig.rB, refSig.rR, refSig.rG, refSig.rB);
          // Flipped orientation: frame's left matches ref's right and vice versa
          const flippedDist = colorDist(sig.lR, sig.lG, sig.lB, refSig.rR, refSig.rG, refSig.rB)
                            + colorDist(sig.rR, sig.rG, sig.rB, refSig.lR, refSig.lG, refSig.lB);

          // If flipped orientation matches better, this frame is mirrored — flip it back
          if (flippedDist < normalDist * 0.7) {
              const fc = frames[f].canvas;
              const flipped = document.createElement('canvas');
              flipped.width = fc.width;
              flipped.height = fc.height;
              const fctx = flipped.getContext('2d')!;
              fctx.imageSmoothingEnabled = false;
              fctx.translate(fc.width, 0);
              fctx.scale(-1, 1);
              fctx.drawImage(fc, 0, 0);
              frames[f] = { canvas: flipped, w: fc.width, h: fc.height };
          }
      }
  }

  // Scale all frames so each row matches the global pixel scale.
  // Use the MAX height of the row (the tallest frame = the correct pixel scale reference).
  // All frames in a row are drawn by the AI at the same pixel scale — height differences
  // are pose variations (standing vs crouching), NOT scale differences.
  // Scaling by max height ensures shorter poses stay proportionally correct.
  for (let i = 0; i < extractedRows.length; i++) {
      const frames = extractedRows[i];
      if (frames.length === 0) continue;
      const rowMaxH = Math.max(...frames.map(f => f.h));
      const scale = globalMaxHeight / rowMaxH;
      if (Math.abs(scale - 1) < 0.05) continue; // close enough, skip
      extractedRows[i] = frames.map(f => {
          const nw = Math.round(f.w * scale);
          const nh = Math.round(f.h * scale);
          const nc = document.createElement('canvas');
          nc.width = nw;
          nc.height = nh;
          const nctx = nc.getContext('2d')!;
          nctx.imageSmoothingEnabled = false;
          nctx.drawImage(f.canvas, 0, 0, nw, nh);
          return { canvas: nc, w: nw, h: nh };
      });
  }

  // Recalculate global max after scaling
  globalMaxWidth = 0;
  globalMaxHeight = 0;
  for (const frames of extractedRows) {
      for (const f of frames) {
          if (f.w > globalMaxWidth) globalMaxWidth = f.w;
          if (f.h > globalMaxHeight) globalMaxHeight = f.h;
      }
  }

  // Normalize all frames within each row to the same size (bottom-center aligned)
  for (let i = 0; i < extractedRows.length; i++) {
      const frames = extractedRows[i];
      if (frames.length === 0) continue;
      extractedRows[i] = frames.map(f => {
          if (f.w === globalMaxWidth && f.h === globalMaxHeight) return f;
          const nc = document.createElement('canvas');
          nc.width = globalMaxWidth;
          nc.height = globalMaxHeight;
          const nctx = nc.getContext('2d')!;
          const dx = Math.floor((globalMaxWidth - f.w) / 2);
          const dy = globalMaxHeight - f.h; // bottom-align
          nctx.drawImage(f.canvas, dx, dy);
          return { canvas: nc, w: globalMaxWidth, h: globalMaxHeight };
      });
  }

  // Calculate target canvas size — no extra padding so viewport can simply divide by rows/cols
  const cellWidth = globalMaxWidth;
  const cellHeight = globalMaxHeight;
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * framesPerRow;
  canvas.height = cellHeight * rowImagesBase64.length; 
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas context");

  for (let rowIndex = 0; rowIndex < extractedRows.length; rowIndex++) {
      const frames = extractedRows[rowIndex];
      for (let fIndex = 0; fIndex < frames.length; fIndex++) {
          const frame = frames[fIndex];
          if (!frame || !frame.canvas) continue;

          // Draw aligning to bottom-center of the cell
          const dx = fIndex * cellWidth + (cellWidth - frame.w) / 2;
          const dy = rowIndex * cellHeight + (cellHeight - frame.h);
          
          ctx.drawImage(frame.canvas, dx, dy, frame.w, frame.h);
      }
  }

  return canvas.toDataURL('image/png');
}
