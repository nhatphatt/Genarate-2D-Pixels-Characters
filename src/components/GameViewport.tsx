import { useEffect, useRef, useState } from 'react';

interface GameViewportProps {
  spriteSheetData: string | null;
  framesPerRow?: number;
  totalRows?: number;
}

export const GameViewport = ({ spriteSheetData, framesPerRow = 4, totalRows = 7 }: GameViewportProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [speed, setSpeed] = useState(150);
  const [flipDefault, setFlipDefault] = useState(false);
  
  const keys = useRef<Record<string, boolean>>({});
  const gameState = useRef({
     x: 0,
     y: 0,
     vx: 0,
     vy: 0,
     facing: 1, // 1: right, -1: left
     action: 0, // 0: Idle, 1: Walk, 2: Run, 3: Attack, 4: Jump, 5: Hurt, 6: Death
     frameIndex: 0,
     isAttacking: false,
     isDead: false,
  });
  const lastTickRef = useRef(performance.now());
  const lastFrameTimeRef = useRef(performance.now());
  const flipDefaultRef = useRef(flipDefault);

  useEffect(() => {
     flipDefaultRef.current = flipDefault;
  }, [flipDefault]);

  // Key listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Keep a loaded image ref so we never flash blank during re-loads
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const totalRowsRef = useRef(totalRows);
  useEffect(() => { totalRowsRef.current = totalRows; }, [totalRows]);

  useEffect(() => {
    if (!spriteSheetData) return;
    
    const img = new Image();
    img.src = spriteSheetData;
    let animationFrameId: number;
    let cancelled = false;

    const startRenderLoop = () => {
      if (cancelled) return;
      loadedImgRef.current = img;

      const render = (time: number) => {
        if (cancelled) return;
        const activeImg = loadedImgRef.current;
        if (!activeImg || !canvasRef.current) {
          animationFrameId = requestAnimationFrame(render);
          return;
        }

        const gs = gameState.current;
        let newAction = 0; // Default Idle

        const dt = Math.min((time - lastTickRef.current) / 1000, 0.1);
        lastTickRef.current = time;

        if (gs.isDead) {
          newAction = 6;
        } else if (gs.isAttacking) {
          newAction = 3;
        } else {
          // Input handling
          if (keys.current['KeyK']) {
            gs.isDead = true;
            gs.action = 6;
            gs.frameIndex = 0;
          } else if (keys.current['KeyH']) {
            newAction = 5;
          } else if (keys.current['KeyJ'] || keys.current['KeyZ'] || keys.current['Enter']) {
            gs.isAttacking = true;
            newAction = 3;
            gs.frameIndex = 0;
            setTimeout(() => { if (gameState.current) gameState.current.isAttacking = false; }, speed * framesPerRow);
          } else {
            if (keys.current['ArrowRight'] || keys.current['KeyD']) {
              gs.vx = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 200 : 100;
              gs.facing = 1;
              newAction = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 2 : 1;
            } else if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
              gs.vx = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? -200 : -100;
              gs.facing = -1;
              newAction = keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 2 : 1;
            } else {
              gs.vx = 0;
            }

            if ((keys.current['Space'] || keys.current['ArrowUp'] || keys.current['KeyW']) && gs.y === 0) {
              gs.vy = -550;
            }
          }

          if (gs.y < 0 || gs.vy < 0) {
            newAction = 4;
          }
        }

        // Physics
        gs.vy += 900 * dt;
        gs.x += gs.vx * dt;
        gs.y += gs.vy * dt;

        if (gs.y > 0) { gs.y = 0; gs.vy = 0; }

        const canvas = canvasRef.current;
        if (gs.x > canvas.width / 2 + 50) gs.x = -canvas.width / 2 - 50;
        if (gs.x < -canvas.width / 2 - 50) gs.x = canvas.width / 2 + 50;

        // Clamp action to valid row range
        const rows = totalRowsRef.current;
        if (newAction >= rows) newAction = 0;

        if (gs.action !== newAction) {
          gs.action = newAction;
          gs.frameIndex = 0;
        }

        // Frame tick
        if (time - lastFrameTimeRef.current > speed) {
          if (gs.action === 6 && gs.frameIndex === framesPerRow - 1) {
            // stay dead
          } else {
            gs.frameIndex = (gs.frameIndex + 1) % framesPerRow;
          }
          lastFrameTimeRef.current = time;
        }

        // Render
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const frameW = activeImg.width / framesPerRow;
        const frameH = activeImg.height / rows;

        // Clamp action & frame to prevent drawing outside the image
        const safeAction = Math.min(gs.action, rows - 1);
        const sx = gs.frameIndex * frameW;
        const sy = safeAction * frameH;

        ctx.imageSmoothingEnabled = false;

        const scale = Math.min((canvas.width * 0.7) / frameW, (canvas.height * 0.7) / frameH);
        const dw = frameW * scale;
        const dh = frameH * scale;

        const floorY = canvas.height - 10;

        ctx.save();
        ctx.translate(canvas.width / 2 + gs.x, floorY + gs.y);

        const requiresFlip = gs.facing === (flipDefaultRef.current ? 1 : -1);
        if (requiresFlip) {
          ctx.scale(-1, 1);
        }

        ctx.drawImage(activeImg, sx, sy, frameW, frameH, -dw / 2, -dh, dw, dh);
        ctx.restore();

        animationFrameId = requestAnimationFrame(render);
      };

      animationFrameId = requestAnimationFrame(render);
    };

    if (img.complete && img.naturalWidth > 0) {
      startRenderLoop();
    } else {
      img.onload = startRenderLoop;
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [spriteSheetData, speed, framesPerRow]);

  const simulateKey = (code: string, isDown: boolean) => {
      keys.current[code] = isDown;
  };

  const handleRevive = () => {
     gameState.current.isDead = false;
     gameState.current.action = 0;
     gameState.current.frameIndex = 0;
  };

  const CtrlBtn = ({ label, code }: { label: string, code: string }) => (
      <button 
         onPointerDown={() => simulateKey(code, true)}
         onPointerUp={() => simulateKey(code, false)}
         onPointerLeave={() => simulateKey(code, false)}
         className="bg-[#161616] border-2 border-zinc-700 text-[#E0E0E0] hover:bg-[#BDFF00] hover:text-black font-black uppercase tracking-widest text-xs px-3 py-2 transition-colors select-none"
      >
         {label}
      </button>
  );

  return (
    <div className="flex flex-col gap-4 border-4 border-zinc-800 bg-[#161616] p-4 shadow-[4px_4px_0_#BDFF00]">
      {/* Viewport Canvas */}
      <canvas 
        ref={canvasRef} 
        width={640} 
        height={480} 
        className="mx-auto w-full aspect-video border-2 border-zinc-800 bg-[#0D0D0D] cursor-crosshair focus:outline-none focus:border-[#BDFF00]"
        style={{ imageRendering: 'pixelated' }}
        tabIndex={0}
      />
      
      {/* Virtual Controls */}
      <div className="bg-[#0D0D0D] p-4 border-2 border-zinc-800 flex flex-col gap-3">
         <div className="flex justify-between items-center bg-[#161616] border-2 border-zinc-700 p-2">
            <h4 className="font-bold text-[#BDFF00] uppercase text-xs tracking-widest font-mono">🕹️ Animation Controls</h4>
            <label className="flex items-center gap-2 text-xs font-mono text-zinc-400 cursor-pointer">
               <input 
                 type="checkbox" 
                 checked={flipDefault} 
                 onChange={e => setFlipDefault(e.target.checked)}
                 className="accent-[#BDFF00] w-4 h-4"
               />
               CHARACTER GENERATED FACING LEFT
            </label>
         </div>
         
         <div className="flex flex-wrap gap-2 mt-2">
            <CtrlBtn label="← Walk L" code="ArrowLeft" />
            <CtrlBtn label="Walk R →" code="ArrowRight" />
            <CtrlBtn label="Attack (J)" code="KeyJ" />
            <CtrlBtn label="Jump (W)" code="KeyW" />
         </div>
         <div className="flex flex-wrap gap-2">
            <button 
               onPointerDown={() => { simulateKey('ArrowRight', true); simulateKey('ShiftLeft', true); }}
               onPointerUp={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
               onPointerLeave={() => { simulateKey('ArrowRight', false); simulateKey('ShiftLeft', false); }}
               className="bg-[#161616] border-2 border-zinc-700 text-[#E0E0E0] hover:bg-[#BDFF00] hover:text-black font-black uppercase tracking-widest text-xs px-3 py-2 transition-colors select-none"
            >
               Run →
            </button>
            <CtrlBtn label="Hurt (H)" code="KeyH" />
            <button key="death" onClick={() => simulateKey('KeyK', true)} className="bg-[#161616] border-2 border-zinc-700 text-red-500 hover:bg-red-500 hover:text-white font-black uppercase tracking-widest text-xs px-3 py-2 transition-colors">
               Death (K)
            </button>
         </div>
      </div>

      <div className="flex justify-between items-center bg-[#0D0D0D] p-4 border-2 border-zinc-800">
         <label className="text-zinc-400 font-mono text-sm font-bold uppercase shrink-0">Speed: {speed}ms</label>
         <input 
           type="range" 
           min="50" max="300" step="10" 
           value={speed} onChange={e => setSpeed(Number(e.target.value))}
           className="accent-[#BDFF00] w-full mx-4"
         />
         <button onClick={handleRevive} className="bg-zinc-800 text-white hover:bg-[#BDFF00] hover:text-black font-black uppercase text-xs px-4 py-2 transition-colors shrink-0">Revive</button>
      </div>
    </div>
  );
};
