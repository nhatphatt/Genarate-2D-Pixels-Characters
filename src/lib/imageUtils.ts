/**
 * Remove chroma key background using 2-stage approach:
 *   1. Strict flood fill from edges (low tolerance) - never eats character
 *   2. Mask expansion - only expand to neighboring fringe pixels
 *
 * This works for green-skinned characters (Shrek) because:
 *   - Stage 1 tolerance is too strict to reach character skin
 *   - Stage 2 only expands when a pixel is mostly surrounded by already-transparent,
 *     which only happens at true fringe, not in character interior
 */
export async function removeBackground(dataUrl: string, _tolerance: number = 55): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const w = img.width, h = img.height;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return reject(new Error("No canvas context"));

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;

            // =========================================================
            // Step 1: Detect bg color from perimeter
            // Use median of perimeter pixels, not mode — more robust
            // =========================================================
            const edgeR: number[] = [], edgeG: number[] = [], edgeB: number[] = [];
            const collectEdge = (x: number, y: number) => {
                const i = (y * w + x) * 4;
                if (data[i + 3] > 200) {
                    edgeR.push(data[i]);
                    edgeG.push(data[i + 1]);
                    edgeB.push(data[i + 2]);
                }
            };
            for (let x = 0; x < w; x++) { collectEdge(x, 0); collectEdge(x, h - 1); }
            for (let y = 0; y < h; y++) { collectEdge(0, y); collectEdge(w - 1, y); }

            edgeR.sort((a, b) => a - b);
            edgeG.sort((a, b) => a - b);
            edgeB.sort((a, b) => a - b);
            const mid = edgeR.length >> 1;
            let bgR = edgeR[mid] ?? 0;
            let bgG = edgeG[mid] ?? 255;
            let bgB = edgeB[mid] ?? 0;

            const distFromBg = (i: number): number => {
                const dr = data[i] - bgR, dg = data[i+1] - bgG, db = data[i+2] - bgB;
                return Math.sqrt(dr*dr + dg*dg + db*db);
            };

            // =========================================================
            // Step 2: STRICT flood fill from edges (low tolerance)
            // Only pixels VERY close to bg color. Never enters character.
            // =========================================================
            const STRICT_TOL = 35;
            const removed = new Uint8Array(w * h);
            const stack: number[] = [];
            for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
            for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }

            while (stack.length > 0) {
                const sy = stack.pop()!;
                const sx = stack.pop()!;
                if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
                const vi = sy * w + sx;
                if (removed[vi]) continue;
                const i = vi * 4;
                if (data[i + 3] === 0 || distFromBg(i) <= STRICT_TOL) {
                    removed[vi] = 1;
                    data[i + 3] = 0;
                    // 4-directional only for strict phase (prevents diagonal leaks through pixel art)
                    stack.push(sx - 1, sy);
                    stack.push(sx + 1, sy);
                    stack.push(sx, sy - 1);
                    stack.push(sx, sy + 1);
                }
            }

            // =========================================================
            // Step 3: Mask expansion for fringe pixels
            // A pixel becomes part of mask if:
            //   - it has distance <= LOOSE_TOL from bg AND
            //   - majority of its neighbors are already transparent
            //
            // This catches anti-aliased fringe without entering character body,
            // because character interior pixels don't have transparent neighbors.
            //
            // Multiple passes allow fringe to be eaten gradually.
            // =========================================================
            const LOOSE_TOL = 130;
            const THRESHOLD = 5; // need 5/8 neighbors removed
            let changed = true;
            let iterations = 0;
            while (changed && iterations < 3) {
                changed = false;
                iterations++;
                // Snapshot current removed state so we only check against previous iteration
                const snapshot = new Uint8Array(removed);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const vi = y * w + x;
                        if (snapshot[vi]) continue;
                        const i = vi * 4;
                        if (data[i + 3] === 0) continue;

                        const dist = distFromBg(i);
                        if (dist > LOOSE_TOL) continue;

                        let rmCount = 0;
                        for (let dy = -1; dy <= 1; dy++)
                            for (let dx = -1; dx <= 1; dx++) {
                                if (!dx && !dy) continue;
                                const nx = x + dx, ny = y + dy;
                                if (nx < 0 || nx >= w || ny < 0 || ny >= h) rmCount++;
                                else if (snapshot[ny * w + nx]) rmCount++;
                            }

                        if (rmCount >= THRESHOLD) {
                            removed[vi] = 1;
                            data[i + 3] = 0;
                            changed = true;
                        }
                    }
                }
            }

            // =========================================================
            // Step 4: Adaptive fringe cleanup
            // A pixel is fringe if:
            //   1. It has at least 1 transparent neighbor
            //   2. Either: distance <= FRINGE_TOL (close to bg)
            //      OR:     distance < 0.9 * avg neighbor distance (closer to bg than neighbors = on the gradient from character to bg)
            //
            // Case A: Shrek skin fringe pixel rgb(130,180,60) dist 161, neighbors = Shrek skin dist 157
            //   -> ratio ~1.0, not flagged -> SAFE
            // Case B: Naruto fringe pixel dist 150, neighbors = real Naruto orange (280)
            //   -> ratio ~0.5, flagged -> REMOVED
            // Case C: Pure fringe dist 80 with green neighbors avg 90 -> distance <= tol -> REMOVED
            // =========================================================
            const FRINGE_TOL = 100;
            for (let pass = 0; pass < 3; pass++) {
                const snap = new Uint8Array(removed);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const vi = y * w + x;
                        if (snap[vi]) continue;
                        const i = vi * 4;
                        if (data[i + 3] === 0) continue;

                        const pixelDist = distFromBg(i);
                        // Absolute lower bound: never consider pixel if very far from bg
                        if (pixelDist > 200) continue;

                        let hasTransparent = false;
                        let opaqueNeighborDistSum = 0;
                        let opaqueCount = 0;
                        for (let dy = -1; dy <= 1; dy++)
                            for (let dx = -1; dx <= 1; dx++) {
                                if (!dx && !dy) continue;
                                const nx = x + dx, ny = y + dy;
                                if (nx < 0 || nx >= w || ny < 0 || ny >= h) { hasTransparent = true; continue; }
                                const ni = ny * w + nx;
                                if (snap[ni]) { hasTransparent = true; }
                                else {
                                    opaqueNeighborDistSum += distFromBg(ni * 4);
                                    opaqueCount++;
                                }
                            }
                        if (!hasTransparent) continue;
                        if (opaqueCount === 0) { removed[vi] = 1; data[i + 3] = 0; continue; }

                        const avgNeighborDist = opaqueNeighborDistSum / opaqueCount;

                        // Condition A: very close to bg AND neighbors are not pure character
                        const closeToBg = pixelDist <= FRINGE_TOL && avgNeighborDist < 180;
                        // Condition B: on gradient from character to bg (pixel closer to bg than neighbors)
                        const onGradient = pixelDist < avgNeighborDist * 0.85;

                        if (closeToBg || onGradient) {
                            removed[vi] = 1;
                            data[i + 3] = 0;
                        }
                    }
                }
            }

            // =========================================================
            // Step 5: Green blob removal (shadow/ground cleanup)
            // AI sometimes draws a darker-green shadow blob under character feet.
            // Detection criteria (all must match):
            //   - Cluster is green-ish (G dominant, in shadow distance range)
            //   - Cluster size < 3% of image (shadows are small)
            //   - Either touches removed bg OR sits near bottom half of image
            //     (AI always places shadow below character, never above)
            // =========================================================
            const SHADOW_MIN = 90;
            const SHADOW_MAX = 200;
            const isGreenish = (i: number): boolean => {
                const r = data[i], g = data[i+1], b = data[i+2];
                if (data[i + 3] === 0) return false;
                if (g <= r || g <= b) return false;
                if (g < r + 15 || g < b + 15) return false;
                const dist = distFromBg(i);
                return dist >= SHADOW_MIN && dist <= SHADOW_MAX;
            };

            const MAX_SHADOW_SIZE = Math.round(w * h * 0.03);

            const visited = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const start = y * w + x;
                    if (visited[start] || removed[start]) continue;
                    if (!isGreenish(start * 4)) continue;

                    // BFS to find cluster
                    const cluster: number[] = [];
                    const q: number[] = [start];
                    visited[start] = 1;
                    let touchesRemoved = false;
                    let minClusterY = h, maxClusterY = 0;
                    while (q.length > 0) {
                        const v = q.shift()!;
                        cluster.push(v);
                        const cx = v % w, cy = (v / w) | 0;
                        if (cy < minClusterY) minClusterY = cy;
                        if (cy > maxClusterY) maxClusterY = cy;
                        for (let dy = -1; dy <= 1; dy++)
                            for (let dx = -1; dx <= 1; dx++) {
                                if (!dx && !dy) continue;
                                const nx = cx + dx, ny = cy + dy;
                                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                                const ni = ny * w + nx;
                                if (removed[ni]) { touchesRemoved = true; continue; }
                                if (visited[ni]) continue;
                                if (isGreenish(ni * 4)) {
                                    visited[ni] = 1;
                                    q.push(ni);
                                }
                            }
                    }

                    // Remove cluster if it's small enough (shadow size)
                    // No need to check touchesRemoved — small green clusters not on character
                    // are either shadow blobs or stray pixels; both should be removed.
                    // Character bodies/vests have thousands of pixels and won't match.
                    if (cluster.length < MAX_SHADOW_SIZE) {
                        // Extra safety: cluster must be in bottom 70% of image (shadows never on top)
                        // OR must touch removed bg (fringe case)
                        if (touchesRemoved || minClusterY > h * 0.3) {
                            for (const v of cluster) {
                                removed[v] = 1;
                                data[v * 4 + 3] = 0;
                            }
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

const CHAR_SIZE = 512;

export function normalizeCharacterSize(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;

            let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
            for (let y = 0; y < c.height; y++)
                for (let x = 0; x < c.width; x++)
                    if (d[(y * c.width + x) * 4 + 3] > 10) {
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                    }
            if (maxX <= minX || maxY <= minY) return resolve(dataUrl);

            const bw = maxX - minX + 1, bh = maxY - minY + 1;
            const side = Math.max(bw, bh);
            const margin = Math.round(side * 0.1);
            const full = side + margin * 2;

            const out = document.createElement('canvas');
            out.width = CHAR_SIZE; out.height = CHAR_SIZE;
            const octx = out.getContext('2d')!;
            octx.imageSmoothingEnabled = false;
            const dx = (CHAR_SIZE - (bw / full) * CHAR_SIZE) / 2;
            const dy = (CHAR_SIZE - (bh / full) * CHAR_SIZE) / 2;
            octx.drawImage(img, minX, minY, bw, bh, dx, dy, (bw / full) * CHAR_SIZE, (bh / full) * CHAR_SIZE);
            resolve(out.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error("Image load error"));
        img.src = dataUrl;
    });
}
