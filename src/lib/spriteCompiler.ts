/**
 * Compile a sprite sheet from per-row, per-frame image data URLs.
 *
 * IMPORTANT — INPUT FORMAT:
 *   `rowFrames[rowIdx]` is the ordered list of individual frame data-URLs for
 *   that animation row (one URL per frame, transparent background already
 *   removed). Pass `null` for rows that have no animation generated yet.
 *
 *   This replaces the old "compile from a horizontal strip image" pipeline.
 *   Going through the strip required gap-detection / span-splitting fallbacks
 *   that silently produced empty frames whenever the AI rendered slightly
 *   touching poses or whenever the row's frame count changed. Receiving the
 *   per-frame images directly is exact: N URLs in -> N frames out, no slicing.
 *
 *   The viewport divides the sheet into a grid of cells whose number of
 *   columns equals the LONGEST row in this character's animation set, so each
 *   row's frame i lands in cell (rowIdx, i). Rows shorter than that are left
 *   blank in the trailing cells.
 */
export async function compileSpriteSheet(
    rowFrames: ((string[] | null)[]) | (string | null)[],
    /**
     * Either the legacy uniform frame count (number) or an explicit per-row
     * frame count (number[]). When omitted we infer the count from
     * `rowFrames[i].length`. Used only to determine the sheet's column count
     * when a row is provided but has fewer frames than the column count.
     */
    framesPerRow?: number | number[],
    referenceImageBase64?: string,
    /**
     * Row indices whose frames should be treated as a "stable loop" (e.g.
     * Idle). For these rows the compiler suppresses per-row scaling and locks
     * every frame's horizontal alignment to the FIRST frame's feet, so that
     * tiny pose differences between frames do not become a left/right flicker
     * when looped in the viewport.
     */
    stableRows?: Set<number>,
): Promise<string> {
    // ------------------------------------------------------------------
    // Normalize input to (string[] | null)[]
    //   - Accept the legacy (string | null)[] form (one strip URL per row) as
    //     a fallback, but only when accompanied by a `framesPerRow` count;
    //     internally we still flatten it by slicing the strip into equal
    //     widths. This path is no longer the primary code path because it
    //     was the source of the missing-frame bug. Prefer passing per-frame
    //     URLs.
    // ------------------------------------------------------------------
    const isPerFrameArray = (rowFrames as unknown[]).every(
        r => r === null || Array.isArray(r),
    );

    let normalizedRows: (string[] | null)[];
    if (isPerFrameArray) {
        normalizedRows = rowFrames as (string[] | null)[];
    } else {
        // Legacy shape: each row is a strip URL. Build a per-row frame count
        // from `framesPerRow` (single number or array) and equal-slice the
        // strip into that many frames in-memory. We document this fallback
        // but do not exercise it in the current app.
        const legacy = rowFrames as (string | null)[];
        const getCount = (i: number) =>
            Array.isArray(framesPerRow) ? (framesPerRow[i] ?? 4) : (framesPerRow ?? 4);
        normalizedRows = await Promise.all(
            legacy.map(async (stripUrl, i) => {
                if (!stripUrl) return null;
                return await sliceStripIntoFrames(stripUrl, getCount(i));
            }),
        );
    }

    // ------------------------------------------------------------------
    // Compute the sheet's column count = max frames across rows.
    //   We prefer the explicit `framesPerRow` argument when provided so the
    //   caller can pad the sheet wider than the actual frames if needed; in
    //   practice both numbers agree.
    // ------------------------------------------------------------------
    const inferredCounts = normalizedRows.map(r => (r ? r.length : 0));
    const maxFramesPerRow = (() => {
        if (Array.isArray(framesPerRow)) return Math.max(1, ...framesPerRow, ...inferredCounts);
        if (typeof framesPerRow === 'number') return Math.max(1, framesPerRow, ...inferredCounts);
        return Math.max(1, ...inferredCounts);
    })();

    // ------------------------------------------------------------------
    // Load every frame URL into an HTMLImageElement, then trim each one to
    // its tight bounding box (skipping transparent pixels and the near-black
    // outline pixels that removeBackground may leave behind on the edges).
    //   The result mirrors the old "extracted frames" structure so the rest
    //   of the pipeline (flip detection, scaling, normalization) is reused.
    // ------------------------------------------------------------------
    const loadImage = (url: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = url;
        });

    const trimToBoundingBox = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const cx = c.getContext('2d', { willReadFrequently: true })!;
        cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, img.width, img.height).data;
        const W = img.width, H = img.height;

        let minX = W, maxX = -1, minY = H, maxY = -1;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                const a = d[idx + 3];
                const r = d[idx], g = d[idx + 1], b = d[idx + 2];
                // Skip transparent + the thin near-black outline halo
                if (a > 10 && (r + g + b) > 30) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) {
            // Empty frame — return a 1x1 transparent placeholder so the row
            // still has the requested number of slots.
            const fc = document.createElement('canvas');
            fc.width = 1; fc.height = 1;
            return { canvas: fc, w: 1, h: 1 };
        }
        const fw = maxX - minX + 1;
        const fh = maxY - minY + 1;
        const fc = document.createElement('canvas');
        fc.width = fw; fc.height = fh;
        const fctx = fc.getContext('2d')!;
        fctx.drawImage(c, minX, minY, fw, fh, 0, 0, fw, fh);
        return { canvas: fc, w: fw, h: fh };
    };

    type Frame = { canvas: HTMLCanvasElement; w: number; h: number };

    const extractedRows: Frame[][] = [];
    let globalMaxWidth = 0;
    let globalMaxHeight = 0;

    for (let i = 0; i < normalizedRows.length; i++) {
        const list = normalizedRows[i];
        if (!list || list.length === 0) {
            extractedRows[i] = [];
            continue;
        }
        const frames: Frame[] = [];
        for (const url of list) {
            const img = await loadImage(url);
            const f = trimToBoundingBox(img);
            frames.push(f);
            if (f.w > globalMaxWidth) globalMaxWidth = f.w;
            if (f.h > globalMaxHeight) globalMaxHeight = f.h;
        }
        extractedRows[i] = frames;
    }

    if (globalMaxWidth === 0 || globalMaxHeight === 0) {
        throw new Error('No frames to compile');
    }

    // ------------------------------------------------------------------
    // AUTO-FLIP DETECTION (Rule 4 enforcement)
    //   Detects mirrored frames by comparing color patterns of left vs right
    //   thirds of each frame against a reference signature taken from either
    //   `referenceImageBase64` or row-0 / frame-0. If a frame's flipped
    //   orientation matches the reference better than its drawn orientation,
    //   we flip it horizontally.
    // ------------------------------------------------------------------
    const getColorSignature = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const thirdW = Math.floor(canvas.width / 3);
        let lR = 0, lG = 0, lB = 0, lN = 0;
        let rR = 0, rG = 0, rB = 0, rN = 0;
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                const a = d[idx + 3], r = d[idx], g = d[idx + 1], b = d[idx + 2];
                if (a <= 10 || (r + g + b) <= 30) continue;
                if (x < thirdW) { lR += r; lG += g; lB += b; lN++; }
                else if (x >= canvas.width - thirdW) { rR += r; rG += g; rB += b; rN++; }
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

    let globalRefSig: ReturnType<typeof getColorSignature> = null;
    let globalRefAsymmetry = 0;
    if (referenceImageBase64) {
        const refImg = await loadImage(referenceImageBase64);
        const refCanvas = document.createElement('canvas');
        refCanvas.width = refImg.width;
        refCanvas.height = refImg.height;
        refCanvas.getContext('2d')!.drawImage(refImg, 0, 0);
        globalRefSig = getColorSignature(refCanvas);
    } else if (extractedRows.length > 0 && extractedRows[0]?.length > 0) {
        globalRefSig = getColorSignature(extractedRows[0][0].canvas);
    }
    if (globalRefSig) {
        globalRefAsymmetry = colorDist(
            globalRefSig.lR, globalRefSig.lG, globalRefSig.lB,
            globalRefSig.rR, globalRefSig.rG, globalRefSig.rB,
        );
    }

    for (let i = 0; i < extractedRows.length; i++) {
        const frames = extractedRows[i];
        if (frames.length === 0) continue;
        const refSig = (globalRefAsymmetry >= 15) ? globalRefSig! : getColorSignature(frames[0].canvas);
        if (!refSig) continue;
        const refAsym = colorDist(refSig.lR, refSig.lG, refSig.lB, refSig.rR, refSig.rG, refSig.rB);
        if (refAsym < 15) continue;
        for (let f = 0; f < frames.length; f++) {
            const sig = getColorSignature(frames[f].canvas);
            if (!sig) continue;
            const normalDist = colorDist(sig.lR, sig.lG, sig.lB, refSig.lR, refSig.lG, refSig.lB)
                             + colorDist(sig.rR, sig.rG, sig.rB, refSig.rR, refSig.rG, refSig.rB);
            const flippedDist = colorDist(sig.lR, sig.lG, sig.lB, refSig.rR, refSig.rG, refSig.rB)
                              + colorDist(sig.rR, sig.rG, sig.rB, refSig.lR, refSig.lG, refSig.lB);
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

    // ------------------------------------------------------------------
    // Per-row scale to globalMaxHeight.
    //   All frames in a row are drawn at the same pixel scale by the AI;
    //   any height variance comes from pose differences (crouching vs
    //   standing). Scaling each row by globalMaxHeight / rowMaxHeight makes
    //   row-to-row character size consistent.
    //
    //   Stable rows (Idle) skip this step entirely so the breathing motion's
    //   1–2px height variance is preserved verbatim — re-scaling would turn
    //   the breathing into a flicker.
    // ------------------------------------------------------------------
    for (let i = 0; i < extractedRows.length; i++) {
        const frames = extractedRows[i];
        if (frames.length === 0) continue;
        if (stableRows && stableRows.has(i)) continue;
        const rowMaxH = Math.max(...frames.map(f => f.h));
        const scale = globalMaxHeight / rowMaxH;
        if (Math.abs(scale - 1) < 0.05) continue;
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

    // Recalculate global max after scaling (some rows may have grown).
    globalMaxWidth = 0;
    globalMaxHeight = 0;
    for (const frames of extractedRows) {
        for (const f of frames) {
            if (f.w > globalMaxWidth) globalMaxWidth = f.w;
            if (f.h > globalMaxHeight) globalMaxHeight = f.h;
        }
    }

    // ------------------------------------------------------------------
    // Find the horizontal center of the bottom band of opaque pixels — i.e.
    // the character's feet — used to anchor stable rows so the breathing
    // motion does not slide left/right when arms swing.
    // ------------------------------------------------------------------
    const getFeetCenterX = (cv: HTMLCanvasElement): number | null => {
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        const bandH = Math.max(6, Math.floor(H * 0.15));
        let sumX = 0, count = 0;
        for (let y = H - 1; y >= H - bandH && y >= 0; y--) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                const a = d[idx + 3];
                const r = d[idx], g = d[idx + 1], b = d[idx + 2];
                if (a > 10 && (r + g + b) > 30) {
                    sumX += x; count++;
                }
            }
        }
        if (count === 0) return null;
        return sumX / count;
    };

    // ------------------------------------------------------------------
    // Normalize: pad every frame canvas to (globalMaxWidth × globalMaxHeight),
    // bottom-aligned. For stable rows align by feet-center of frame 0.
    // ------------------------------------------------------------------
    for (let i = 0; i < extractedRows.length; i++) {
        const frames = extractedRows[i];
        if (frames.length === 0) continue;
        const isStable = !!(stableRows && stableRows.has(i));
        const anchorFeetX = isStable ? getFeetCenterX(frames[0].canvas) : null;

        extractedRows[i] = frames.map(f => {
            const nc = document.createElement('canvas');
            nc.width = globalMaxWidth;
            nc.height = globalMaxHeight;
            const nctx = nc.getContext('2d')!;
            nctx.imageSmoothingEnabled = false;
            let dx: number;
            if (isStable && anchorFeetX !== null) {
                const myFeetX = getFeetCenterX(f.canvas);
                const targetCenterX = globalMaxWidth / 2;
                if (myFeetX !== null) {
                    dx = Math.round(targetCenterX - myFeetX);
                } else {
                    dx = Math.floor((globalMaxWidth - f.w) / 2);
                }
                // Clamp dx so the frame never spills outside the cell — even
                // a slightly out-of-range dx would bleed into the neighbor
                // cell on the final sheet, which manifests as missing frames.
                dx = Math.max(0, Math.min(globalMaxWidth - f.w, dx));
            } else {
                dx = Math.floor((globalMaxWidth - f.w) / 2);
            }
            const dy = globalMaxHeight - f.h;
            nctx.drawImage(f.canvas, dx, dy);
            return { canvas: nc, w: globalMaxWidth, h: globalMaxHeight };
        });
    }

    // ------------------------------------------------------------------
    // Final composition: sheet is `maxFramesPerRow` cells wide and N rows
    // tall. Each frame canvas now matches cellWidth × cellHeight exactly.
    // ------------------------------------------------------------------
    const cellWidth = globalMaxWidth;
    const cellHeight = globalMaxHeight;
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth * maxFramesPerRow;
    canvas.height = cellHeight * normalizedRows.length;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No canvas context');

    for (let rowIndex = 0; rowIndex < extractedRows.length; rowIndex++) {
        const frames = extractedRows[rowIndex];
        for (let fIndex = 0; fIndex < frames.length; fIndex++) {
            const frame = frames[fIndex];
            if (!frame || !frame.canvas) continue;
            // Frames are already cell-sized after the normalize pass, so dx
            // is just `fIndex * cellWidth` and dy is `rowIndex * cellHeight`.
            ctx.drawImage(frame.canvas, fIndex * cellWidth, rowIndex * cellHeight);
        }
    }

    return canvas.toDataURL('image/png');
}

// ----------------------------------------------------------------------
// LEGACY HELPER — only used when the caller passes the old (string | null)[]
// shape (one strip URL per row). Splits a horizontal strip into N frames by
// equal-width slicing. Kept solely for backwards compatibility; callers
// should prefer passing per-frame URLs.
// ----------------------------------------------------------------------
async function sliceStripIntoFrames(stripUrl: string, n: number): Promise<string[]> {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = stripUrl;
    });
    const w = img.width, h = img.height;
    const sliceW = Math.floor(w / n);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        const c = document.createElement('canvas');
        c.width = i === n - 1 ? w - i * sliceW : sliceW;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, i * sliceW, 0, c.width, h, 0, 0, c.width, h);
        out.push(c.toDataURL('image/png'));
    }
    return out;
}
