import { useEffect, useRef, useState } from 'react';
import { formatKeyCode } from './HotkeyChip';

interface GameViewportProps {
  spriteSheetData: string | null;
  /** Total columns in the sprite sheet (= max frames across rows). */
  framesPerRow?: number;
  /** Per-row frame count when rows have different lengths. Falls back to `framesPerRow` if absent. */
  framesPerRowList?: number[];
  totalRows?: number;
  /** Per-row playback metadata. RFC-002 §G4 + RFC-003.
   *  Index aligned with `framesPerRowList`. Falls back to 8 fps / forward / "" when absent. */
  animationsMeta?: { name: string; fps: number; loop: 'forward' | 'pingpong' | 'once'; keyBind: string }[];
}

const BACKGROUNDS = [
  { id: 'none', label: 'None', src: '' },
  { id: 'forest', label: 'Forest', src: '/backgrounds/forest.png' },
  { id: 'sky', label: 'Sky Islands', src: '/backgrounds/sky.png' },
  { id: 'village', label: 'Village', src: '/backgrounds/village.png' },
];

// Platform layout
const PLATFORMS = [
  { x: 80, y: 340, w: 140, h: 18 },
  { x: 300, y: 280, w: 120, h: 18 },
  { x: 500, y: 220, w: 100, h: 18 },
  { x: 180, y: 180, w: 110, h: 18 },
];

// ---------- Hit-spark + dust particles ------------------------------------
type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  life: number;       // remaining seconds
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
};

interface Enemy {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hit: boolean;
  hitTimer: number;
  dead: boolean;
  deadTimer: number;
  platformIdx: number; // -1 = ground
}

const CW = 640, CH = 480;
const GRAVITY = 900;
const JUMP_VEL = -550;
const FLOOR_Y = CH - 10;

export const GameViewport = ({ spriteSheetData, framesPerRow = 4, framesPerRowList, totalRows = 7, animationsMeta }: GameViewportProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speed, setSpeed] = useState(150);
  const [flipDefault, setFlipDefault] = useState(false);
  const [bgId, setBgId] = useState('forest');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPlatforms, setShowPlatforms] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const keys = useRef<Record<string, boolean>>({});
  const gameState = useRef({
    x: 0, y: 0, vx: 0, vy: 0,
    facing: 1,
    action: 0, frameIndex: 0,
    isAttacking: false, isDead: false,
    /** Index of the currently-playing one-shot animation row, or null when
     *  no one-shot is active. RFC-003 §Render loop refactor. The dispatcher
     *  refuses to start another one-shot until this clears (re-trigger
     *  ignored — acceptance test #7). For Death (its loop === 'once' too)
     *  we deliberately keep this set so the character pins on the last
     *  frame; `handleRevive` clears it. */
    oneShotRow: null as number | null,
    onPlatform: -1, // -1 = ground or air
    // visual-only state for camera shake (decays over time)
    shakeAmp: 0,
    // tracks previous airborne state so we can spawn landing dust on transition
    wasAirborne: false,
  });
  const enemies = useRef<Enemy[]>([]);
  const particles = useRef<Particle[]>([]);
  const lastTickRef = useRef(performance.now());
  const lastFrameTimeRef = useRef(performance.now());
  const flipDefaultRef = useRef(flipDefault);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const showPlatformsRef = useRef(showPlatforms);

  useEffect(() => { flipDefaultRef.current = flipDefault; }, [flipDefault]);
  useEffect(() => { showPlatformsRef.current = showPlatforms; }, [showPlatforms]);

  // Load background image
  useEffect(() => {
    const bg = BACKGROUNDS.find(b => b.id === bgId);
    if (!bg || !bg.src) { bgImgRef.current = null; return; }
    const img = new Image();
    img.src = bg.src;
    img.onload = () => { bgImgRef.current = img; };
  }, [bgId]);

  // Key listeners
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; e.preventDefault(); };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const totalRowsRef = useRef(totalRows);
  useEffect(() => { totalRowsRef.current = totalRows; }, [totalRows]);
  // Live ref to per-row frame counts so the render loop sees updates without restarting.
  const framesPerRowListRef = useRef<number[] | undefined>(framesPerRowList);
  useEffect(() => { framesPerRowListRef.current = framesPerRowList; }, [framesPerRowList]);

  // Live ref to per-row playback metadata (name + fps + loop + keyBind).
  // Updated without restarting the loop so renames/rebinds take effect live.
  const animationsMetaRef = useRef<{ name: string; fps: number; loop: 'forward' | 'pingpong' | 'once'; keyBind: string }[] | undefined>(animationsMeta);
  useEffect(() => { animationsMetaRef.current = animationsMeta; }, [animationsMeta]);

  // Ping-pong direction state, one slot per row. +1 = forward, -1 = reverse.
  // Mutated by the render loop, never re-allocated, so it survives prop updates.
  const pingpongDirRef = useRef<number[]>([]);

  // Spawn enemy
  const spawnEnemy = () => {
    const platIdx = Math.random() < 0.4 ? -1 : Math.floor(Math.random() * PLATFORMS.length);
    const plat = platIdx >= 0 ? PLATFORMS[platIdx] : null;
    const ex = plat ? plat.x + plat.w / 2 : 100 + Math.random() * (CW - 200);
    const ey = plat ? plat.y : FLOOR_Y;
    enemies.current.push({ x: ex, y: ey, hp: 3, maxHp: 3, hit: false, hitTimer: 0, dead: false, deadTimer: 0, platformIdx: platIdx });
  };

  // ---------- Particle helpers ------------------------------------------
  const spawnHitSpark = (x: number, y: number) => {
    // Bright pixel sparks at the impact point — yellow + white mix
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 120;
      particles.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.25 + Math.random() * 0.15,
        maxLife: 0.4,
        color: Math.random() < 0.5 ? '#FFD93D' : '#FFFFFF',
        size: 2 + Math.floor(Math.random() * 2),
        gravity: 200,
      });
    }
  };
  const spawnLandingDust = (x: number, y: number) => {
    // Two small puffs to either side of the feet
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 4; i++) {
        particles.current.push({
          x: x + s * 4,
          y,
          vx: s * (40 + Math.random() * 50),
          vy: -20 - Math.random() * 30,
          life: 0.35 + Math.random() * 0.1,
          maxLife: 0.45,
          color: '#C9B58A', // warm dust
          size: 2 + Math.floor(Math.random() * 2),
          gravity: 80,
        });
      }
    }
  };

  useEffect(() => {
    if (!spriteSheetData) return;
    const img = new Image();
    img.src = spriteSheetData;
    let animId: number;
    let cancelled = false;

    const start = () => {
      if (cancelled) return;
      loadedImgRef.current = img;

      const render = (time: number) => {
        if (cancelled) return;
        const activeImg = loadedImgRef.current;
        if (!activeImg || !canvasRef.current) { animId = requestAnimationFrame(render); return; }

        const gs = gameState.current;
        const dt = Math.min((time - lastTickRef.current) / 1000, 0.1);
        lastTickRef.current = time;
        let newAction = 0;

        const usePlatforms = showPlatformsRef.current;
        const meta = animationsMetaRef.current;

        // Helper: lower-cased name lookup (cached per tick).
        const nameOf = (idx: number) => (meta?.[idx]?.name ?? '').trim().toLowerCase();

        // Locate the Death row (if any) — its index is the only one allowed
        // to keep `oneShotRow` pinned past the last frame so the character
        // stays "dead". Other one-shots clear automatically.
        let deathRowIdx = -1;
        if (meta) {
          for (let i = 0; i < meta.length; i++) {
            if (nameOf(i) === 'death') { deathRowIdx = i; break; }
          }
        }

        // ---- 1. Continue an in-flight one-shot (Attack / Hurt / Death /
        //         custom once) until its last frame, ignoring re-triggers.
        if (gs.oneShotRow !== null) {
          newAction = gs.oneShotRow;
          // Sync legacy booleans for the existing camera-shake / death paths.
          gs.isDead      = gs.oneShotRow === deathRowIdx;
          gs.isAttacking = nameOf(gs.oneShotRow) === 'attack';
        } else {
          gs.isAttacking = false;
          gs.isDead      = false;

          // ---- 2. Scan non-locomotion rows for a triggered key. Priority:
          //         Death > Hurt > Attack > custom. Within "custom" we go in
          //         row order. First match wins; once-rows lock further scans.
          const LOCO = new Set(['idle', 'walk', 'run', 'jump']);
          let triggeredIdx = -1;
          let triggeredLoop: 'forward' | 'pingpong' | 'once' = 'forward';
          if (meta) {
            // Two passes: priority names first (death/hurt/attack), then the
            // remaining rows in declared order. This matches the legacy
            // behaviour for the 7 default actions and gives custom rows a
            // predictable, stable order.
            const priorityOrder = ['death', 'hurt', 'attack'];
            for (const targetName of priorityOrder) {
              for (let i = 0; i < meta.length; i++) {
                const n = nameOf(i);
                if (n !== targetName) continue;
                const code = meta[i].keyBind;
                if (code && keys.current[code]) {
                  triggeredIdx = i;
                  triggeredLoop = meta[i].loop;
                  break;
                }
              }
              if (triggeredIdx >= 0) break;
            }
            // Custom rows fallback (anything not in LOCO and not a priority).
            if (triggeredIdx < 0) {
              for (let i = 0; i < meta.length; i++) {
                const n = nameOf(i);
                if (LOCO.has(n) || priorityOrder.includes(n)) continue;
                const code = meta[i].keyBind;
                if (code && keys.current[code]) {
                  triggeredIdx = i;
                  triggeredLoop = meta[i].loop;
                  break;
                }
              }
            }
          }

          if (triggeredIdx >= 0) {
            if (triggeredLoop === 'once') {
              // Latch a one-shot. The frame tick advances frameIndex up to
              // safeRowFrames-1, and the post-tick check below clears
              // gs.oneShotRow when we land on the last frame (except Death,
              // which stays pinned).
              gs.oneShotRow = triggeredIdx;
              gs.frameIndex = 0;
              if (triggeredIdx === deathRowIdx) {
                gs.isDead = true;
                gs.shakeAmp = Math.max(gs.shakeAmp, 6);
              }
              if (nameOf(triggeredIdx) === 'attack') gs.isAttacking = true;
              if (nameOf(triggeredIdx) === 'hurt')   gs.shakeAmp = Math.max(gs.shakeAmp, 3);
              newAction = triggeredIdx;
            } else {
              // forward / pingpong: hold-to-loop, no latching.
              newAction = triggeredIdx;
            }
          } else {
            // ---- 3. Locomotion (unchanged). Arrow keys + Shift modifier +
            //         Space/W/Up for jump. These rows are looked up by name
            //         so reordering or adding rows above them in step 2
            //         does not break the dispatcher.
            const walkIdx = meta?.findIndex(m => m.name.trim().toLowerCase() === 'walk') ?? -1;
            const runIdx  = meta?.findIndex(m => m.name.trim().toLowerCase() === 'run')  ?? -1;
            const jumpIdx = meta?.findIndex(m => m.name.trim().toLowerCase() === 'jump') ?? -1;
            const sprint  = !!(keys.current['ShiftLeft'] || keys.current['ShiftRight']);

            if (keys.current['ArrowRight'] || keys.current['KeyD']) {
              gs.vx = sprint ? 200 : 100;
              gs.facing = 1;
              newAction = sprint ? (runIdx >= 0 ? runIdx : 2) : (walkIdx >= 0 ? walkIdx : 1);
            } else if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
              gs.vx = sprint ? -200 : -100;
              gs.facing = -1;
              newAction = sprint ? (runIdx >= 0 ? runIdx : 2) : (walkIdx >= 0 ? walkIdx : 1);
            } else { gs.vx = 0; }

            // Jump - check if on ground or on a platform (vy must be 0 = not already mid-air)
            const onSurface = gs.vy === 0;
            if ((keys.current['Space'] || keys.current['ArrowUp'] || keys.current['KeyW']) && onSurface) {
              gs.vy = JUMP_VEL;
              gs.onPlatform = -1;
            }
          }
          // Airborne always overrides locomotion with the Jump row.
          if (gs.vy !== 0) {
            const jumpIdx = meta?.findIndex(m => m.name.trim().toLowerCase() === 'jump') ?? -1;
            newAction = jumpIdx >= 0 ? jumpIdx : 4;
          }
        }

        // Physics
        gs.vy += GRAVITY * dt;
        gs.x += gs.vx * dt;
        const prevY = gs.y;
        const wasAirborne = gs.vy !== 0 || gs.y < 0;
        gs.y += gs.vy * dt;

        // Ground collision
        if (gs.y > 0) { gs.y = 0; gs.vy = 0; }

        // Platform collision (only when falling down)
        if (usePlatforms && gs.vy > 0) {
          const charScreenX = CW / 2 + gs.x;
          // charFeetY = FLOOR_Y + gs.y = screen Y of character's feet
          const prevFeetY = FLOOR_Y + prevY;
          const curFeetY = FLOOR_Y + gs.y;
          for (let i = 0; i < PLATFORMS.length; i++) {
            const p = PLATFORMS[i];
            // Check horizontal overlap
            if (charScreenX > p.x + 10 && charScreenX < p.x + p.w - 10) {
              // Feet crossed through platform top surface this frame
              if (prevFeetY <= p.y && curFeetY >= p.y) {
                gs.y = p.y - FLOOR_Y;
                gs.vy = 0;
                gs.onPlatform = i;
                break;
              }
            }
          }
        }

        // Detect landing transition (was airborne, now grounded) -> dust puff
        const isAirborne = gs.vy !== 0 || gs.y < 0;
        if (gs.wasAirborne && !isAirborne) {
          spawnLandingDust(CW / 2 + gs.x, FLOOR_Y + gs.y);
        }
        gs.wasAirborne = isAirborne;
        // suppress unused-var warning (kept for symmetry with reads above)
        void wasAirborne;

        // Wrap around
        const canvas = canvasRef.current;
        if (gs.x > CW / 2 + 50) gs.x = -CW / 2 - 50;
        if (gs.x < -CW / 2 - 50) gs.x = CW / 2 + 50;

        // Attack collision with enemies
        if (gs.isAttacking && gs.frameIndex >= 2) {
          const charSX = CW / 2 + gs.x;
          const charSY = FLOOR_Y + gs.y;
          const atkRange = 60;
          for (const e of enemies.current) {
            if (e.dead || e.hit) continue;
            const dx = e.x - charSX, dy = e.y - charSY;
            const inRange = gs.facing === 1 ? (dx > -20 && dx < atkRange) : (dx < 20 && dx > -atkRange);
            if (inRange && Math.abs(dy) < 50) {
              e.hp--;
              e.hit = true;
              e.hitTimer = 0.25;
              spawnHitSpark(e.x, e.y - 24);
              gs.shakeAmp = Math.max(gs.shakeAmp, 4);
              if (e.hp <= 0) { e.dead = true; e.deadTimer = 1.2; gs.shakeAmp = Math.max(gs.shakeAmp, 6); }
            }
          }
        }

        // Update enemies
        for (const e of enemies.current) {
          if (e.hit) { e.hitTimer -= dt; if (e.hitTimer <= 0) e.hit = false; }
          if (e.dead) { e.deadTimer -= dt; }
        }
        enemies.current = enemies.current.filter(e => !e.dead || e.deadTimer > 0);

        // Update particles
        for (const pt of particles.current) {
          pt.life -= dt;
          pt.vy += pt.gravity * dt;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
        }
        particles.current = particles.current.filter(p => p.life > 0);

        // Decay camera shake
        if (gs.shakeAmp > 0) {
          gs.shakeAmp = Math.max(0, gs.shakeAmp - dt * 30);
        }

        // Clamp action
        const rows = totalRowsRef.current;
        if (newAction >= rows) newAction = 0;
        if (gs.action !== newAction) { gs.action = newAction; gs.frameIndex = 0; pingpongDirRef.current[newAction] = 1; }

        // Per-row frame count (some rows may have fewer frames than the sheet's max columns)
        const rowFrames = (framesPerRowListRef.current && framesPerRowListRef.current[gs.action])
          ? framesPerRowListRef.current[gs.action]
          : framesPerRow;
        const safeRowFrames = Math.max(1, rowFrames);

        // Clamp current frameIndex into the active row's range (e.g. switching from 8-frame Walk to 2-frame Hurt).
        if (gs.frameIndex >= safeRowFrames) gs.frameIndex = 0;

        // Per-action playback. RFC-002 §G4.
        // The animation row's fps drives the in-app viewport so the user sees
        // exactly what their game engine will play. The `speed` slider is now
        // a global multiplier on top — at 1× it matches the stored fps, at
        // 2× it plays double speed, etc.
        const rowMeta = animationsMetaRef.current?.[gs.action];
        const baseFps = rowMeta?.fps ?? 8;
        const loop: 'forward' | 'pingpong' | 'once' = rowMeta?.loop ?? 'forward';
        // `speed` was originally locomotion ms/frame. Convert it to a
        // multiplier around its old default (150 ms ≈ 1×) so existing UI
        // semantics (lower = faster) survive: multiplier = 150 / speed.
        const speedMultiplier = Math.max(0.05, 150 / Math.max(1, speed));
        const effectiveFps = Math.max(0.5, baseFps * speedMultiplier);
        const frameDuration = 1000 / effectiveFps;

        // Frame tick
        if (time - lastFrameTimeRef.current > frameDuration) {
          // Ensure ping-pong direction slot exists for this row.
          if (pingpongDirRef.current[gs.action] === undefined) pingpongDirRef.current[gs.action] = 1;

          // Death (= the active one-shot whose row is the Death row) holds
          // on its last frame forever; Revive clears gs.oneShotRow.
          const isActiveDeath = gs.oneShotRow === deathRowIdx && deathRowIdx >= 0;

          if (isActiveDeath && gs.frameIndex === safeRowFrames - 1) {
            /* Death stays on its last frame */
          } else if (loop === 'once') {
            // Play through to the last frame, then hold (or unlatch).
            if (gs.frameIndex < safeRowFrames - 1) {
              gs.frameIndex++;
            } else if (gs.oneShotRow !== null && !isActiveDeath) {
              // One-shot finished — clear the latch so the next tick can
              // re-evaluate the dispatcher and either keep playing this row
              // (if it's still triggered as a forward-loop kind, but it
              // isn't because loop === 'once') or fall back to Idle/locomotion.
              gs.oneShotRow = null;
              gs.isAttacking = false;
            }
          } else if (loop === 'pingpong' && safeRowFrames > 1) {
            const dir = pingpongDirRef.current[gs.action] ?? 1;
            const next = gs.frameIndex + dir;
            if (next >= safeRowFrames) {
              // bounce off the end: step back one
              gs.frameIndex = safeRowFrames - 2;
              pingpongDirRef.current[gs.action] = -1;
            } else if (next < 0) {
              gs.frameIndex = 1;
              pingpongDirRef.current[gs.action] = 1;
            } else {
              gs.frameIndex = next;
            }
          } else {
            // forward loop (default)
            gs.frameIndex = (gs.frameIndex + 1) % safeRowFrames;
          }
          lastFrameTimeRef.current = time;
        }

        // ===== RENDER =====
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        // Camera shake offset (integer pixels so we don't blur the pixel art)
        const shakeX = gs.shakeAmp > 0 ? Math.round((Math.random() - 0.5) * gs.shakeAmp * 2) : 0;
        const shakeY = gs.shakeAmp > 0 ? Math.round((Math.random() - 0.5) * gs.shakeAmp * 2) : 0;
        ctx.save();
        ctx.translate(shakeX, shakeY);

        // Background
        if (bgImgRef.current) {
          ctx.drawImage(bgImgRef.current, 0, 0, CW, CH);
        } else {
          // Subtle vertical gradient instead of flat black so empty bg doesn't look broken
          const grad = ctx.createLinearGradient(0, 0, 0, CH);
          grad.addColorStop(0, '#1a1a2e');
          grad.addColorStop(0.6, '#16213e');
          grad.addColorStop(1, '#0f3460');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, CW, CH);
          // Star field for the void background
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          for (let i = 0; i < 40; i++) {
            // deterministic pseudo-stars based on i so they don't twinkle randomly
            const sx = (i * 73) % CW;
            const sy = (i * 131) % (CH - 60);
            ctx.fillRect(sx, sy, 1, 1);
          }
        }

        // Platforms (drawn before character so character renders on top)
        if (usePlatforms) {
          for (const p of PLATFORMS) {
            // Soft drop shadow under the platform
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(p.x + 3, p.y + p.h, p.w, 4);

            // Dirt body
            ctx.fillStyle = '#6b4a1e';
            ctx.fillRect(p.x, p.y + 6, p.w, p.h - 6);

            // Dirt darker speckles (deterministic per platform)
            ctx.fillStyle = '#4a3414';
            for (let i = 0; i < Math.floor(p.w / 14); i++) {
              const sx = p.x + 4 + (i * 19) % (p.w - 6);
              const sy = p.y + 9 + ((i * 7) % (p.h - 10));
              ctx.fillRect(sx, sy, 2, 2);
            }

            // Grass top band
            ctx.fillStyle = '#5a8c3f';
            ctx.fillRect(p.x, p.y, p.w, 6);
            // Brighter grass highlight (top 2px)
            ctx.fillStyle = '#7bb55a';
            ctx.fillRect(p.x, p.y, p.w, 2);
            // Random grass blades on top
            ctx.fillStyle = '#9bd57a';
            for (let i = 0; i < Math.floor(p.w / 8); i++) {
              const bx = p.x + 2 + (i * 11) % (p.w - 3);
              ctx.fillRect(bx, p.y - 1, 1, 1);
            }

            // Dirt bottom dark edge (1px) for depth
            ctx.fillStyle = '#2e1f0a';
            ctx.fillRect(p.x, p.y + p.h - 1, p.w, 1);
          }

          // Ground (richer than before): grass + dirt + speckles + base shadow
          // Grass band
          ctx.fillStyle = '#5a8c3f';
          ctx.fillRect(0, FLOOR_Y, CW, 6);
          ctx.fillStyle = '#7bb55a';
          ctx.fillRect(0, FLOOR_Y, CW, 2);
          // Grass blades
          ctx.fillStyle = '#9bd57a';
          for (let i = 0; i < CW / 6; i++) {
            const bx = (i * 7) % CW;
            ctx.fillRect(bx, FLOOR_Y - 1, 1, 1);
          }
          // Dirt
          ctx.fillStyle = '#6b4a1e';
          ctx.fillRect(0, FLOOR_Y + 6, CW, CH - FLOOR_Y - 6);
          // Dirt speckles (small stones)
          ctx.fillStyle = '#4a3414';
          for (let i = 0; i < 30; i++) {
            const sx = (i * 23) % CW;
            const sy = FLOOR_Y + 9 + ((i * 5) % 10);
            ctx.fillRect(sx, sy, 2, 2);
          }
          ctx.fillStyle = '#8a6332';
          for (let i = 0; i < 18; i++) {
            const sx = (i * 37 + 11) % CW;
            const sy = FLOOR_Y + 7 + ((i * 3) % 12);
            ctx.fillRect(sx, sy, 1, 1);
          }
        }

        // Enemies
        const frameW = activeImg.width / framesPerRow;
        const frameH = activeImg.height / rows;
        const scale = Math.min((CW * 0.15) / frameW, (CH * 0.25) / frameH);
        const ew = frameW * scale, eh = frameH * scale;
        for (const e of enemies.current) {
          // Drop shadow on the surface beneath the enemy
          if (!e.dead) {
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            const shW = ew * 0.55;
            const shH = 4;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y - 1, shW / 2, shH / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.save();
          ctx.translate(e.x, e.y);
          if (e.dead) {
            // Smooth ease-out fade + falling rotation
            const t = 1 - e.deadTimer / 1.2;
            ctx.globalAlpha = 1 - t * t;
            ctx.rotate((Math.PI / 2) * t); // tip over to lying down
            ctx.translate(0, t * 8); // sink down a bit
          }
          // Draw idle frame 0, flipped (facing left = toward player)
          ctx.scale(-1, 1);
          ctx.drawImage(activeImg, 0, 0, frameW, frameH, -ew / 2, -eh, ew, eh);
          ctx.restore();

          // HP bar — clean, no flicker
          if (!e.dead) {
            const barW = 32, barH = 4;
            const bx = Math.round(e.x - barW / 2);
            const by = Math.round(e.y - eh - 10);
            // Outer dark frame
            ctx.fillStyle = '#000';
            ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
            // Background
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(bx, by, barW, barH);
            // Fill
            const hpRatio = e.hp / e.maxHp;
            ctx.fillStyle = hpRatio > 0.5 ? '#5dd35d' : hpRatio > 0.25 ? '#ffb84d' : '#e63946';
            ctx.fillRect(bx, by, Math.round(barW * hpRatio), barH);
            // 1px highlight on top of fill for retro feel
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(bx, by, Math.round(barW * hpRatio), 1);
          }
        }

        // Character drop shadow on the surface (size shrinks with height in air)
        const charScale = Math.min((CW * 0.18) / frameW, (CH * 0.3) / frameH);
        const dw = frameW * charScale, dh = frameH * charScale;
        const safeAction = Math.min(gs.action, rows - 1);
        const sx = gs.frameIndex * frameW;
        const sy = safeAction * frameH;

        // Surface y for the shadow: ground or current platform top
        let surfaceY = FLOOR_Y;
        if (gs.onPlatform >= 0 && gs.vy === 0) surfaceY = PLATFORMS[gs.onPlatform].y;
        const charScreenX = CW / 2 + gs.x;
        // air = 0..1 where 1 = far above the surface
        const airAmount = Math.min(1, Math.max(0, (surfaceY - (FLOOR_Y + gs.y)) / 120));
        const shadowW = dw * (0.55 - airAmount * 0.35);
        const shadowH = 6 - airAmount * 4;
        const shadowAlpha = (1 - airAmount * 0.6) * 0.4;
        if (shadowW > 1 && shadowH > 0.5) {
          ctx.save();
          ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
          ctx.beginPath();
          ctx.ellipse(charScreenX, surfaceY - 1, shadowW / 2, Math.max(1, shadowH / 2), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Character
        ctx.save();
        ctx.translate(charScreenX, FLOOR_Y + gs.y);
        if (gs.facing === (flipDefaultRef.current ? 1 : -1)) ctx.scale(-1, 1);
        ctx.drawImage(activeImg, sx, sy, frameW, frameH, -dw / 2, -dh, dw, dh);
        ctx.restore();

        // Particles
        for (const pt of particles.current) {
          const lifeRatio = Math.max(0, pt.life / pt.maxLife);
          ctx.fillStyle = pt.color;
          ctx.globalAlpha = lifeRatio;
          ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
        }
        ctx.globalAlpha = 1;

        ctx.restore(); // end shake

        // Vignette (drawn AFTER shake so the dark frame stays still)
        const vGrad = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CH * 0.75);
        vGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vGrad.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, CW, CH);

        // Top-left HUD: action label + frame indicator
        const ACTIONS = ['IDLE', 'WALK', 'RUN', 'ATTACK', 'JUMP', 'HURT', 'DEATH'];
        ctx.fillStyle = 'rgba(15, 15, 15, 0.75)';
        ctx.fillRect(8, 8, 134, 22);
        ctx.strokeStyle = 'rgba(46, 46, 46, 1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(8.5, 8.5, 133, 21);
        ctx.fillStyle = '#3ecf8e';
        ctx.font = '500 11px ui-monospace, "Source Code Pro", "Courier New", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${ACTIONS[gs.action] || 'IDLE'}  ${gs.frameIndex + 1}/${safeRowFrames}`, 14, 19);

        animId = requestAnimationFrame(render);
      };
      animId = requestAnimationFrame(render);
    };

    if (img.complete && img.naturalWidth > 0) start();
    else img.onload = start;
    return () => { cancelled = true; cancelAnimationFrame(animId); };
  }, [spriteSheetData, speed, framesPerRow]);

  const simulateKey = (code: string, isDown: boolean) => { keys.current[code] = isDown; };
  const handleRevive = () => {
    const gs = gameState.current;
    gs.isDead = false; gs.action = 0; gs.frameIndex = 0;
    // Clear any latched one-shot (Death pins itself, but a stuck Attack /
    // Hurt / custom one-shot would also block locomotion).
    gs.oneShotRow = null;
    gs.isAttacking = false;
    // Defensive: if the user was holding K (keyboard) or clicked Death and the
    // release hadn't fired yet, clear it so the next render tick doesn't
    // immediately re-kill the character.
    keys.current['KeyK'] = false;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const CtrlBtn = ({ label, code, className: cx }: { label: string; code: string; className?: string }) => (
    <button
      onPointerDown={() => simulateKey(code, true)}
      onPointerUp={() => simulateKey(code, false)}
      onPointerLeave={() => simulateKey(code, false)}
      className={`rounded-md bg-[#171717] border border-[#2e2e2e] text-[#b4b4b4] hover:text-[#fafafa] hover:border-[#363636] text-[12px] font-medium px-3 py-1.5 transition-colors select-none ${cx || ''}`}
    >{label}</button>
  );

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-3 ${isFullscreen ? 'bg-[#0f0f0f] w-screen h-screen' : 'rounded-xl bg-[#171717] p-3 border border-[#2e2e2e]'}`}
    >
      {/* Viewport */}
      <div className={`relative ${isFullscreen ? 'flex-1 flex items-center justify-center' : ''}`}>
        <canvas
          ref={canvasRef} width={CW} height={CH}
          className={`bg-black focus:outline-none ${isFullscreen ? 'h-full max-h-screen' : 'mx-auto w-full rounded-lg border border-[#2e2e2e]'}`}
          style={{ imageRendering: 'pixelated', aspectRatio: `${CW}/${CH}` }}
          tabIndex={0}
        />
        {/* Corner accents — brand emerald */}
        {!isFullscreen && (
          <>
            <div className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-l-[2px] border-t-[2px] border-[#3ecf8e] rounded-tl-lg" />
            <div className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-r-[2px] border-t-[2px] border-[#3ecf8e] rounded-tr-lg" />
            <div className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-l-[2px] border-b-[2px] border-[#3ecf8e] rounded-bl-lg" />
            <div className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-r-[2px] border-b-[2px] border-[#3ecf8e] rounded-br-lg" />
          </>
        )}
        <button
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 rounded-md bg-[#0f0f0f]/80 text-[#fafafa] px-2.5 py-1 text-[11px] font-medium border border-[#2e2e2e] hover:border-[#3ecf8e]/40 transition-colors z-10"
        >
          {isFullscreen ? 'Esc exit' : 'Fullscreen'}
        </button>
      </div>

      {/* Everything below hidden in fullscreen */}
      {!isFullscreen && (
        <>
        {/* Background selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="label-mono text-[10px] shrink-0">BG</span>
        {BACKGROUNDS.map(b => (
          <button
            key={b.id}
            onClick={() => setBgId(b.id)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-colors shrink-0 ${
              bgId === b.id
                ? 'border-[#3ecf8e]/40 text-[#3ecf8e] bg-[#3ecf8e]/5'
                : 'border-[#2e2e2e] text-[#898989] hover:text-[#fafafa] hover:border-[#363636]'
            }`}
          >
            {b.label}
          </button>
        ))}
        <div className="h-4 w-px bg-[#2e2e2e] mx-1 shrink-0" />
        <label className="flex items-center gap-1.5 text-[12px] text-[#898989] cursor-pointer shrink-0">
          <input type="checkbox" checked={showPlatforms} onChange={e => setShowPlatforms(e.target.checked)} className="accent-[#3ecf8e] w-3 h-3" />
          Platforms
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[#898989] cursor-pointer shrink-0">
          <input type="checkbox" checked={flipDefault} onChange={e => setFlipDefault(e.target.checked)} className="accent-[#3ecf8e] w-3 h-3" />
          Facing left
        </label>
      </div>

      {/* Controls */}
      <div className="rounded-lg bg-[#0f0f0f] p-3 border border-[#2e2e2e] flex flex-col gap-2.5">
        {/* Locomotion group — wired to arrow keys + Shift + Space (legacy). */}
        <div className="flex flex-wrap gap-1.5">
          <CtrlBtn label="← Walk" code="ArrowLeft" />
          <CtrlBtn label="Walk →" code="ArrowRight" />
          <button
            onPointerDown={() => { simulateKey('ArrowRight', true); simulateKey('ShiftLeft', true); }}
            onPointerUp={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
            onPointerLeave={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
            className="rounded-md bg-[#171717] border border-[#2e2e2e] text-[#b4b4b4] hover:text-[#fafafa] hover:border-[#363636] text-[12px] font-medium px-3 py-1.5 transition-colors select-none"
          >Run →</button>
          <CtrlBtn label="Jump" code="KeyW" />

          <div className="h-6 w-px bg-[#2e2e2e] mx-0.5" />

          <button
            onClick={spawnEnemy}
            className="rounded-md bg-[#171717] border border-[#2e2e2e] text-[hsl(28,90%,68%)] hover:border-[hsl(28,90%,40%)] text-[12px] font-medium px-3 py-1.5 transition-colors select-none"
          >
            + Enemy
          </button>
          <button
            onClick={() => { enemies.current = []; }}
            className="rounded-md bg-[#171717] border border-[#2e2e2e] text-[#898989] hover:text-[#fafafa] hover:border-[#363636] text-[12px] font-medium px-3 py-1.5 transition-colors select-none"
          >
            Clear
          </button>
          <button
            onClick={handleRevive}
            className="rounded-md bg-[#171717] border border-[#3ecf8e]/30 text-[#3ecf8e] hover:bg-[#3ecf8e]/5 text-[12px] font-medium px-3 py-1.5 transition-colors select-none"
          >
            Revive
          </button>
        </div>

        {/* Action group — RFC-003. One button per non-locomotion animation
         *  row, built dynamically so custom actions added in step 2 appear
         *  here automatically. Once-loop rows tap-and-release; forward /
         *  pingpong rows hold-to-loop. */}
        {animationsMeta && animationsMeta.length > 0 && (() => {
          const LOCO = new Set(['idle', 'walk', 'run', 'jump']);
          const triggerable = animationsMeta
            .map((m, i) => ({ ...m, index: i }))
            .filter(m => !LOCO.has(m.name.trim().toLowerCase()));
          if (triggerable.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1.5 items-center pt-2.5 border-t border-[#2e2e2e]">
              <span className="label-mono text-[10px] shrink-0 mr-1">ACTIONS</span>
              {triggerable.map(a => {
                const lower = a.name.trim().toLowerCase();
                // Color hints for the canonical three damage/death actions.
                const accent =
                  lower === 'death' ? 'text-[hsl(348,80%,72%)] hover:border-[hsl(348,75%,40%)]' :
                  lower === 'hurt'  ? 'text-[hsl(38,90%,72%)] hover:border-[hsl(38,90%,45%)]' :
                                      'text-[#b4b4b4] hover:text-[#fafafa] hover:border-[#363636]';

                const press = () => {
                  if (a.keyBind) simulateKey(a.keyBind, true);
                  // Without a keyBind we still want the dispatcher to fire.
                  // We synthesize a stable pseudo-code derived from the row
                  // index so the render loop can pick it up if you wire
                  // pseudo-codes to keyBind defaults later. For now, no-op
                  // (the dispatcher only reads real keyBinds).
                };
                const release = () => {
                  if (a.keyBind) simulateKey(a.keyBind, false);
                };

                if (a.loop === 'once') {
                  // Tap behaviour: press, auto-release after one tick so
                  // `keys.current[code]` doesn't latch (matching the Death
                  // button fix from RFC-003 prior round).
                  return (
                    <button
                      key={a.index}
                      onClick={() => {
                        if (!a.keyBind) return;
                        simulateKey(a.keyBind, true);
                        setTimeout(() => simulateKey(a.keyBind, false), 50);
                      }}
                      disabled={!a.keyBind}
                      title={a.keyBind ? `Tap to play ${a.name} once` : `${a.name} has no hotkey — set one in step 2`}
                      className={`rounded-md bg-[#171717] border border-[#2e2e2e] text-[12px] font-medium px-3 py-1.5 transition-colors select-none flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${accent}`}
                    >
                      <span>{a.name}</span>
                      {a.keyBind && (
                        <kbd className="px-1 rounded bg-[#0f0f0f] border border-[#2e2e2e] text-[#898989] text-[10px] font-mono leading-none py-0.5">
                          {formatKeyCode(a.keyBind)}
                        </kbd>
                      )}
                    </button>
                  );
                }
                // forward / pingpong: hold-to-play.
                return (
                  <button
                    key={a.index}
                    onPointerDown={press}
                    onPointerUp={release}
                    onPointerLeave={release}
                    disabled={!a.keyBind}
                    title={a.keyBind ? `Hold to play ${a.name}` : `${a.name} has no hotkey — set one in step 2`}
                    className={`rounded-md bg-[#171717] border border-[#2e2e2e] text-[12px] font-medium px-3 py-1.5 transition-colors select-none flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${accent}`}
                  >
                    <span>{a.name}</span>
                    {a.keyBind && (
                      <kbd className="px-1 rounded bg-[#0f0f0f] border border-[#2e2e2e] text-[#898989] text-[10px] font-mono leading-none py-0.5">
                        {formatKeyCode(a.keyBind)}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        <div className="flex items-center gap-2">
          <span className="label-mono text-[10px] shrink-0">Speed: {speed}ms</span>
          <input type="range" min="50" max="300" step="10" value={speed} onChange={e => setSpeed(Number(e.target.value))}
            className="accent-[#3ecf8e] flex-1" />
        </div>
      </div>
      </>
      )}
    </div>
  );
};
