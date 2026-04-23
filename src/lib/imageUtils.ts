export async function removeBackground(dataUrl: string, tolerance: number = 70): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const w = img.width;
            const h = img.height;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return reject(new Error("No canvas context"));

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;

            // Step 1: Detect chroma key color from perimeter
            const edgeColors: Record<string, { r: number, g: number, b: number, count: number }> = {};
            let maxCount = 0;
            let bgR = 0, bgG = 255, bgB = 0;

            const sample = (x: number, y: number) => {
                const idx = (y * w + x) * 4;
                const r = data[idx], g = data[idx+1], b = data[idx+2];
                const key = `${r >> 3},${g >> 3},${b >> 3}`;
                if (!edgeColors[key]) edgeColors[key] = { r, g, b, count: 0 };
                edgeColors[key].count++;
                if (edgeColors[key].count > maxCount) {
                    maxCount = edgeColors[key].count;
                    bgR = r; bgG = g; bgB = b;
                }
            };
            for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
            for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }

            // If detected bg color is green-dominant, keep it.
            // Otherwise, force #00FF00 since our prompts always request solid green bg.
            // This handles cases where the AI generates a slightly off-green that confuses perimeter detection.
            if (!(bgG >= bgR && bgG >= bgB && bgG > 100)) {
                bgR = 0; bgG = 255; bgB = 0;
            }

            // isBg: per-channel tolerance + green must be highest channel
            const isBg = (idx: number, tol: number = tolerance): boolean => {
                if (data[idx + 3] === 0) return true;
                const r = data[idx], g = data[idx+1], b = data[idx+2];
                if (Math.abs(r - bgR) > tol) return false;
                if (Math.abs(g - bgG) > tol) return false;
                if (Math.abs(b - bgB) > tol) return false;
                // Green must be the highest channel — protects yellow (r>=g) and cyan (b>=g)
                return g >= r && g >= b;
            };

            // Step 2: Flood fill from edges — 8-directional
            const removed = new Uint8Array(w * h);
            const stack: number[] = [];

            for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
            for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }

            while (stack.length > 0) {
                const y = stack.pop()!;
                const x = stack.pop()!;
                if (x < 0 || x >= w || y < 0 || y >= h) continue;
                const vi = y * w + x;
                if (removed[vi]) continue;
                removed[vi] = 1;

                if (!isBg(vi * 4)) { removed[vi] = 0; continue; }
                data[vi * 4 + 3] = 0;

                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++)
                        if (dx !== 0 || dy !== 0) stack.push(x + dx, y + dy);
            }

            // Step 3: Remove trapped green in small gaps (not connected to edge)
            // Only remove if VERY close to bg AND green is dominant
            const halfTol = tolerance * 0.5;
            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                if (data[idx + 3] === 0) continue;
                const r = data[idx], g = data[idx+1], b = data[idx+2];
                if (g >= r && g >= b &&
                    Math.abs(r - bgR) <= halfTol &&
                    Math.abs(g - bgG) <= halfTol &&
                    Math.abs(b - bgB) <= halfTol) {
                    data[idx + 3] = 0;
                    removed[i] = 1;
                }
            }

            // Step 3b: Additional pass — remove any remaining pure-green pixels
            // that are surrounded by transparent pixels (islands of green)
            for (let i = 0; i < w * h; i++) {
                const idx = i * 4;
                if (data[idx + 3] === 0) continue;
                const r = data[idx], g = data[idx+1], b = data[idx+2];
                // Check if pixel is very green (close to #00FF00)
                if (g > 180 && g >= r && g >= b && r < 100 && b < 100) {
                    // Check how many neighbors are already removed
                    const x = i % w, y = Math.floor(i / w);
                    let removedNeighbors = 0;
                    let totalNeighbors = 0;
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = x + dx, ny = y + dy;
                            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                totalNeighbors++;
                                if (removed[ny * w + nx]) removedNeighbors++;
                            }
                        }
                    }
                    // If more than 40% of neighbors in a 5x5 area are removed, this is likely trapped bg
                    if (totalNeighbors > 0 && removedNeighbors / totalNeighbors > 0.4) {
                        data[idx + 3] = 0;
                        removed[i] = 1;
                    }
                }
            }

            // Step 4: Defringe — erode green-dominant pixels adjacent to removed area
            for (let pass = 0; pass < 4; pass++) {
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const vi = y * w + x;
                        const idx = vi * 4;
                        if (data[idx + 3] === 0) continue;

                        let adjacent = false;
                        for (let dy = -1; dy <= 1 && !adjacent; dy++)
                            for (let dx = -1; dx <= 1 && !adjacent; dx++) {
                                const nx = x + dx, ny = y + dy;
                                if (nx >= 0 && nx < w && ny >= 0 && ny < h && removed[ny * w + nx])
                                    adjacent = true;
                            }
                        if (!adjacent) continue;

                        const r = data[idx], g = data[idx+1], b = data[idx+2];
                        if (g >= r && g >= b && isBg(idx)) {
                            // Green-dominant and close to bg — remove
                            data[idx + 3] = 0;
                            removed[vi] = 1;
                        } else if (g > (r + b) / 2 + 10) {
                            // Spill suppression — reduce green excess
                            data[idx + 1] = Math.round((r + b) / 2 + (g - (r + b) / 2) * 0.25);
                        }
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error("Image load error"));
        img.src = dataUrl;
    });
}
