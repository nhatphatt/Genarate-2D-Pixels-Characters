import { useEffect, useRef, useState } from 'react';

interface GameViewportProps {
  spriteSheetData: string | null;
  framesPerRow?: number;
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

export const GameViewport = ({ spriteSheetData, framesPerRow = 4, totalRows = 7 }: GameViewportProps) => {
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
  });
  const enemies = useRef<Enemy[]>([]);
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

  // Spawn enemy
  const spawnEnemy = () => {
    const platIdx = Math.random() < 0.4 ? -1 : Math.floor(Math.random() * PLATFORMS.length);
    const plat = platIdx >= 0 ? PLATFORMS[platIdx] : null;
    const ex = plat ? plat.x + plat.w / 2 : 100 + Math.random() * (CW - 200);
    const ey = plat ? plat.y : FLOOR_Y;
    enemies.current.push({ x: ex, y: ey, hp: 3, maxHp: 3, hit: false, hitTimer: 0, dead: false, deadTimer: 0, platformIdx: platIdx });
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
          if (keys.current['KeyK']) { gs.isDead = true; gs.action = 6; gs.frameIndex = 0; }
          else if (keys.current['KeyH']) { newAction = 5; }
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
              e.hitTimer = 0.3;
              if (e.hp <= 0) { e.dead = true; e.deadTimer = 1.5; }
            }
          }
        }

        // Update enemies
        for (const e of enemies.current) {
          if (e.hit) { e.hitTimer -= dt; if (e.hitTimer <= 0) e.hit = false; }
          if (e.dead) { e.deadTimer -= dt; }
        }
        enemies.current = enemies.current.filter(e => !e.dead || e.deadTimer > 0);

        // Clamp action
        const rows = totalRowsRef.current;
        if (newAction >= rows) newAction = 0;
        if (gs.action !== newAction) { gs.action = newAction; gs.frameIndex = 0; }

        // Frame tick
        if (time - lastFrameTimeRef.current > speed) {
          if (gs.action === 6 && gs.frameIndex === framesPerRow - 1) { /* stay dead */ }
          else if (gs.isAttacking && gs.frameIndex === framesPerRow - 1) { gs.isAttacking = false; }
          else { gs.frameIndex = (gs.frameIndex + 1) % framesPerRow; }
          lastFrameTimeRef.current = time;
        }

        // ===== RENDER =====
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        // Background
        if (bgImgRef.current) {
          ctx.drawImage(bgImgRef.current, 0, 0, CW, CH);
        } else {
          ctx.fillStyle = '#0D0D0D';
          ctx.fillRect(0, 0, CW, CH);
        }

        // Platforms
        if (usePlatforms) {
          for (const p of PLATFORMS) {
            // Grass top
            ctx.fillStyle = '#4a7c3f';
            ctx.fillRect(p.x, p.y, p.w, 6);
            // Dirt
            ctx.fillStyle = '#8B6914';
            ctx.fillRect(p.x, p.y + 6, p.w, p.h - 6);
            // Edge highlights
            ctx.fillStyle = '#5a8c4f';
            ctx.fillRect(p.x, p.y, p.w, 2);
            ctx.fillStyle = '#6B5210';
            ctx.fillRect(p.x, p.y + p.h - 2, p.w, 2);
          }
          // Ground line
          ctx.fillStyle = '#4a7c3f';
          ctx.fillRect(0, FLOOR_Y, CW, 4);
          ctx.fillStyle = '#8B6914';
          ctx.fillRect(0, FLOOR_Y + 4, CW, CH - FLOOR_Y - 4);
        }

        // Enemies
        const frameW = activeImg.width / framesPerRow;
        const frameH = activeImg.height / rows;
        const scale = Math.min((CW * 0.15) / frameW, (CH * 0.25) / frameH);
        for (const e of enemies.current) {
          ctx.save();
          ctx.translate(e.x, e.y);
          if (e.dead) { ctx.globalAlpha = e.deadTimer / 1.5; ctx.rotate(Math.PI / 6); }
          else if (e.hit) { ctx.globalAlpha = 0.5 + Math.sin(time * 0.03) * 0.5; }

          const ew = frameW * scale, eh = frameH * scale;
          // Draw idle frame 0, flipped (facing left = toward player)
          ctx.scale(-1, 1);
          ctx.drawImage(activeImg, 0, 0, frameW, frameH, -ew / 2, -eh, ew, eh);
          ctx.restore();

          // HP bar
          if (!e.dead) {
            const barW = 30, barH = 4;
            ctx.fillStyle = '#333';
            ctx.fillRect(e.x - barW / 2, e.y - eh - 10, barW, barH);
            ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#4CAF50' : '#f44336';
            ctx.fillRect(e.x - barW / 2, e.y - eh - 10, barW * (e.hp / e.maxHp), barH);
          }
        }

        // Character
        const charScale = Math.min((CW * 0.18) / frameW, (CH * 0.3) / frameH);
        const dw = frameW * charScale, dh = frameH * charScale;
        const safeAction = Math.min(gs.action, rows - 1);
        const sx = gs.frameIndex * frameW;
        const sy = safeAction * frameH;

        ctx.save();
        ctx.translate(CW / 2 + gs.x, FLOOR_Y + gs.y);
        if (gs.facing === (flipDefaultRef.current ? 1 : -1)) ctx.scale(-1, 1);
        ctx.drawImage(activeImg, sx, sy, frameW, frameH, -dw / 2, -dh, dw, dh);
        ctx.restore();

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
    <div ref={containerRef} className={`flex flex-col gap-3 ${isFullscreen ? 'bg-black w-screen h-screen' : 'border-2 border-zinc-800 bg-[#161616] p-3'}`}>
      {/* Viewport */}
      <div className={`relative ${isFullscreen ? 'flex-1 flex items-center justify-center' : ''}`}>
        <canvas
          ref={canvasRef} width={CW} height={CH}
          className={`border-2 border-zinc-800 cursor-crosshair focus:outline-none focus:border-[#BDFF00] ${isFullscreen ? 'h-full max-h-screen' : 'mx-auto w-full'}`}
          style={{ imageRendering: 'pixelated', aspectRatio: `${CW}/${CH}` }}
          tabIndex={0}
        />
        <button onClick={toggleFullscreen}
          className="absolute top-2 right-2 bg-black/60 text-white px-2 py-1 text-[10px] font-mono uppercase hover:bg-black/80 transition-colors z-10">
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
