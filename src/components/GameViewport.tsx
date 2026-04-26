import { useEffect, useRef, useState } from 'react';

interface GameViewportProps {
  spriteSheetData: string | null;
  /** Total columns in the sprite sheet (= max frames across rows). */
  framesPerRow?: number;
  /** Per-row frame count when rows have different lengths. Falls back to `framesPerRow` if absent. */
  framesPerRowList?: number[];
  totalRows?: number;
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

export const GameViewport = ({ spriteSheetData, framesPerRow = 4, framesPerRowList, totalRows = 7 }: GameViewportProps) => {
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

        if (gs.isDead) {
          newAction = 6;
        } else if (gs.isAttacking) {
          newAction = 3;
        } else {
          if (keys.current['KeyK']) {
            gs.isDead = true; gs.action = 6; gs.frameIndex = 0;
            gs.shakeAmp = Math.max(gs.shakeAmp, 6);
          }
          else if (keys.current['KeyH']) { newAction = 5; gs.shakeAmp = Math.max(gs.shakeAmp, 3); }
          else if (keys.current['KeyJ'] || keys.current['KeyZ'] || keys.current['Enter']) {
            gs.isAttacking = true; newAction = 3; gs.frameIndex = 0;
          } else {
            if (keys.current['ArrowRight'] || keys.current['KeyD']) {
              gs.vx = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 200 : 100;
              gs.facing = 1;
              newAction = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 2 : 1;
            } else if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
              gs.vx = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? -200 : -100;
              gs.facing = -1;
              newAction = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 2 : 1;
            } else { gs.vx = 0; }

            // Jump - check if on ground or on a platform (vy must be 0 = not already mid-air)
            const onSurface = gs.vy === 0;
            if ((keys.current['Space'] || keys.current['ArrowUp'] || keys.current['KeyW']) && onSurface) {
              gs.vy = JUMP_VEL;
              gs.onPlatform = -1;
            }
          }
          if (gs.vy !== 0) newAction = 4;
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
        if (gs.action !== newAction) { gs.action = newAction; gs.frameIndex = 0; }

        // Per-row frame count (some rows may have fewer frames than the sheet's max columns)
        const rowFrames = (framesPerRowListRef.current && framesPerRowListRef.current[gs.action])
          ? framesPerRowListRef.current[gs.action]
          : framesPerRow;
        const safeRowFrames = Math.max(1, rowFrames);

        // Clamp current frameIndex into the active row's range (e.g. switching from 8-frame Walk to 2-frame Hurt).
        if (gs.frameIndex >= safeRowFrames) gs.frameIndex = 0;

        // Per-action frame duration. Idle (action 0) is a slow breathing loop
        // and should tick noticeably slower than locomotion — otherwise the
        // 1–2px breathing motion plays so fast it reads as a flicker.
        // Standard idle tempo in 2D games is ~150–250ms per frame.
        const frameDuration = gs.action === 0 ? Math.max(speed * 2, 180) : speed;

        // Frame tick
        if (time - lastFrameTimeRef.current > frameDuration) {
          if (gs.action === 6 && gs.frameIndex === safeRowFrames - 1) { /* stay dead */ }
          else if (gs.isAttacking && gs.frameIndex === safeRowFrames - 1) { gs.isAttacking = false; }
          else { gs.frameIndex = (gs.frameIndex + 1) % safeRowFrames; }
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
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(8, 8, 130, 20);
        ctx.fillStyle = '#BDFF00';
        ctx.font = 'bold 11px ui-monospace, "Courier New", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${ACTIONS[gs.action] || 'IDLE'}  ${gs.frameIndex + 1}/${safeRowFrames}`, 14, 18);

        animId = requestAnimationFrame(render);
      };
      animId = requestAnimationFrame(render);
    };

    if (img.complete && img.naturalWidth > 0) start();
    else img.onload = start;
    return () => { cancelled = true; cancelAnimationFrame(animId); };
  }, [spriteSheetData, speed, framesPerRow]);

  const simulateKey = (code: string, isDown: boolean) => { keys.current[code] = isDown; };
  const handleRevive = () => { const gs = gameState.current; gs.isDead = false; gs.action = 0; gs.frameIndex = 0; };

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
      className={`bg-[#161616] border-2 border-zinc-700 text-[#E0E0E0] hover:bg-[#BDFF00] hover:text-black font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none ${cx || ''}`}
    >{label}</button>
  );

  return (
    <div ref={containerRef} className={`flex flex-col gap-3 ${isFullscreen ? 'bg-black w-screen h-screen' : 'bg-[#161616] p-3 border-4 border-black shadow-[6px_6px_0_#BDFF00]'}`}>
      {/* Viewport */}
      <div className={`relative ${isFullscreen ? 'flex-1 flex items-center justify-center' : ''}`}>
        <canvas
          ref={canvasRef} width={CW} height={CH}
          className={`bg-black focus:outline-none ${isFullscreen ? 'h-full max-h-screen' : 'mx-auto w-full border-2 border-zinc-900'}`}
          style={{ imageRendering: 'pixelated', aspectRatio: `${CW}/${CH}` }}
          tabIndex={0}
        />
        {/* Corner accents (decorative pixel-art frame) */}
        {!isFullscreen && (
          <>
            <div className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-l-[3px] border-t-[3px] border-[#BDFF00]" />
            <div className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-r-[3px] border-t-[3px] border-[#BDFF00]" />
            <div className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-l-[3px] border-b-[3px] border-[#BDFF00]" />
            <div className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-r-[3px] border-b-[3px] border-[#BDFF00]" />
          </>
        )}
        <button onClick={toggleFullscreen}
          className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 text-[10px] font-mono uppercase tracking-widest border border-zinc-700 hover:bg-[#BDFF00] hover:text-black hover:border-black transition-colors z-10">
          {isFullscreen ? 'ESC Exit' : 'Fullscreen'}
        </button>
      </div>

      {/* Everything below hidden in fullscreen */}
      {!isFullscreen && (
        <>
        {/* Background selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-zinc-500 font-mono text-[10px] uppercase shrink-0">BG:</span>
        {BACKGROUNDS.map(b => (
          <button key={b.id} onClick={() => setBgId(b.id)}
            className={`px-2 py-1 text-[10px] font-mono uppercase border transition-colors shrink-0 ${bgId === b.id ? 'border-[#BDFF00] text-[#BDFF00] bg-[#BDFF00]/10' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'}`}>
            {b.label}
          </button>
        ))}
        <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" />
        <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 cursor-pointer shrink-0">
          <input type="checkbox" checked={showPlatforms} onChange={e => setShowPlatforms(e.target.checked)} className="accent-[#BDFF00] w-3 h-3" />
          Platforms
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 cursor-pointer shrink-0">
          <input type="checkbox" checked={flipDefault} onChange={e => setFlipDefault(e.target.checked)} className="accent-[#BDFF00] w-3 h-3" />
          Facing Left
        </label>
      </div>

      {/* Controls */}
      <div className="bg-[#0D0D0D] p-3 border border-zinc-800 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <CtrlBtn label="← Walk" code="ArrowLeft" />
          <CtrlBtn label="Walk →" code="ArrowRight" />
          <button
            onPointerDown={() => { simulateKey('ArrowRight', true); simulateKey('ShiftLeft', true); }}
            onPointerUp={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
            onPointerLeave={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
            className="bg-[#161616] border-2 border-zinc-700 text-[#E0E0E0] hover:bg-[#BDFF00] hover:text-black font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none"
          >Run →</button>
          <CtrlBtn label="Jump" code="KeyW" />
          <CtrlBtn label="Attack" code="KeyJ" />
          <CtrlBtn label="Hurt" code="KeyH" />
          <button onClick={() => simulateKey('KeyK', true)}
            className="bg-[#161616] border-2 border-zinc-700 text-red-400 hover:bg-red-500 hover:text-white font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none">
            Death
          </button>
          <div className="h-6 w-px bg-zinc-800 mx-0.5" />
          <button onClick={spawnEnemy}
            className="bg-[#161616] border-2 border-orange-800 text-orange-400 hover:bg-orange-600 hover:text-white font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none">
            + Enemy
          </button>
          <button onClick={() => { enemies.current = []; }}
            className="bg-[#161616] border-2 border-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none">
            Clear
          </button>
          <button onClick={handleRevive}
            className="bg-[#161616] border-2 border-zinc-700 text-emerald-400 hover:bg-emerald-600 hover:text-white font-black uppercase tracking-widest text-[10px] px-2.5 py-1.5 transition-colors select-none">
            Revive
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-mono text-[10px] uppercase shrink-0">Speed: {speed}ms</span>
          <input type="range" min="50" max="300" step="10" value={speed} onChange={e => setSpeed(Number(e.target.value))}
            className="accent-[#BDFF00] flex-1" />
        </div>
      </div>
      </>
      )}
    </div>
  );
};
