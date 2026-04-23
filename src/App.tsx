import { useState } from 'react';
import { generateCharacter, generateAnimationRow, generateIdleRow } from './services/ai';
import { removeBackground } from './lib/imageUtils';
import { compileSpriteSheet } from './lib/spriteCompiler';
import { GameViewport } from './components/GameViewport';
import { AlertCircle, Image as ImageIcon, Sparkles, Play, RefreshCw, XCircle, Upload, Download, Plus, Trash2, FileJson, Monitor, Gamepad2, Info } from 'lucide-react';

const DEFAULT_ANIMATIONS = [
  { name: "Idle" },
  { name: "Walk" },
  { name: "Run" },
  { name: "Attack" },
  { name: "Jump" },
  { name: "Hurt" },
  { name: "Death" }
];
type AppState = 'CREATE_CHAR' | 'CREATE_ANIM' | 'PLAY';

export default function App() {
  const [appState, setAppState] = useState<AppState>('CREATE_CHAR');
  
  const [animations, setAnimations] = useState<{id: string, name: string, customPrompt: string}[]>(
    DEFAULT_ANIMATIONS.map((anim, i) => ({ id: `default-${i}`, name: anim.name, customPrompt: '' }))
  );
  
  const [charPrompt, setCharPrompt] = useState('');
  const [baseCharImage, setBaseCharImage] = useState<string | null>(null);
  const [baseCharNoBg, setBaseCharNoBg] = useState<string | null>(null);
  
  const [animRows, setAnimRows] = useState<(string | null)[]>(Array(7).fill(null));
  const [animRowsNoBg, setAnimRowsNoBg] = useState<(string | null)[]>(Array(7).fill(null));
  
  const [compiledSpriteSheet, setCompiledSpriteSheet] = useState<string | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleError = (error: any) => {
    console.error(error);
    const msg = error?.message || String(error);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
      setErrorMsg("Quota / Rate Limit Exceeded. You have used your free tier limit. Please wait until it resets or supply your own API Key via Settings.");
    } else {
      setErrorMsg(msg);
    }
  };

  const handleGenerateChar = async () => {
    if (!charPrompt.trim()) return;
    setIsGenerating(true);
    setErrorMsg(null);
    setLoadingMsg("Generating base character...");
    try {
      const b64 = await generateCharacter(charPrompt);
      setBaseCharImage(b64);
      setBaseCharNoBg(null); // Reset
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        setErrorMsg('Please upload a valid image file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        if (event.target?.result) {
            setBaseCharImage(event.target.result as string);
            setBaseCharNoBg(null);
            setCharPrompt('');
        }
    };
    reader.onerror = () => {
        setErrorMsg('Failed to read file.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBaseBg = async () => {
    if (!baseCharImage) return;
    setIsGenerating(true);
    setErrorMsg(null);
    setLoadingMsg("Removing green background...");
    try {
      const noBg = await removeBackground(baseCharImage, 70);
      setBaseCharNoBg(noBg);
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateRow = async (rowIndex: number) => {
    if (!baseCharImage) return;
    setIsGenerating(true);
    setErrorMsg(null);
    const animDef = animations[rowIndex];
    setLoadingMsg(`Generating ${animDef.name} animation...`);
    try {
      const sourceImage = baseCharNoBg || baseCharImage;
      const isIdle = animDef.name.toLowerCase() === 'idle' && !animDef.customPrompt?.trim();
      const b64 = isIdle
        ? await generateIdleRow(sourceImage)
        : await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg));
      
      const newRows = [...animRows];
      newRows[rowIndex] = b64;
      setAnimRows(newRows);
      
      // BG removal: idle is already clean (code-generated), AI rows are pre-cleaned
      // inside generateAnimationRow (per-frame removal before combining)
      const noBg = b64;
      
      const newRowsNoBg = [...animRowsNoBg];
      newRowsNoBg[rowIndex] = noBg;
      setAnimRowsNoBg(newRowsNoBg);
      
      // Auto compile
      setLoadingMsg("Compiling Sprite Sheet...");
      const compiled = await compileSpriteSheet(newRowsNoBg, 4);
      setCompiledSpriteSheet(compiled);
      
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAllMissing = async () => {
    if (!baseCharImage) return;
    setIsGenerating(true);
    setErrorMsg(null);
    
    let currentRows = [...animRows];
    let currentRowsNoBg = [...animRowsNoBg];

    try {
      const sourceImage = baseCharNoBg || baseCharImage;
      for (let i = 0; i < animations.length; i++) {
        if (!currentRows[i]) {
          const animDef = animations[i];
          setLoadingMsg(`Generating ${animDef.name} (${i + 1}/${animations.length})...`);
          
          const isIdle = animDef.name.toLowerCase() === 'idle' && !animDef.customPrompt?.trim();
          const b64 = isIdle
            ? await generateIdleRow(sourceImage)
            : await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg));
          currentRows[i] = b64;
          setAnimRows([...currentRows]);
          
          // BG removal: idle is already clean, AI rows are pre-cleaned
          // inside generateAnimationRow (per-frame removal before combining)
          const noBg = b64;
          currentRowsNoBg[i] = noBg;
          setAnimRowsNoBg([...currentRowsNoBg]);
          
          // Brief cooldown between animations (frame-level cooldowns are built-in)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      setLoadingMsg("Compiling final Sprite Sheet...");
      const compiled = await compileSpriteSheet(currentRowsNoBg, 4);
      setCompiledSpriteSheet(compiled);
      
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!baseCharImage) return;
    // Clear all existing rows
    setAnimRows([]);
    setAnimRowsNoBg([]);
    setCompiledSpriteSheet(null);
    setIsGenerating(true);
    setErrorMsg(null);

    const currentRows: (string | null)[] = [];
    const currentRowsNoBg: (string | null)[] = [];

    try {
      const sourceImage = baseCharNoBg || baseCharImage;
      for (let i = 0; i < animations.length; i++) {
        const animDef = animations[i];
        setLoadingMsg(`Re-generating ${animDef.name} (${i + 1}/${animations.length})...`);

        const isIdle = animDef.name.toLowerCase() === 'idle' && !animDef.customPrompt?.trim();
        const b64 = isIdle
          ? await generateIdleRow(sourceImage)
          : await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg));
        currentRows[i] = b64;
        setAnimRows([...currentRows]);

        const noBg = b64;
        currentRowsNoBg[i] = noBg;
        setAnimRowsNoBg([...currentRowsNoBg]);

        // Brief cooldown between animations
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setLoadingMsg("Compiling final Sprite Sheet...");
      const compiled = await compileSpriteSheet(currentRowsNoBg, 4);
      setCompiledSpriteSheet(compiled);

    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateAnimation = (index: number, field: 'name' | 'customPrompt', value: string) => {
    const newAnims = [...animations];
    newAnims[index] = { ...newAnims[index], [field]: value };
    setAnimations(newAnims);
  };

  const handleAddAnimation = () => {
    setAnimations([...animations, { id: Math.random().toString(), name: 'Custom Action', customPrompt: '' }]);
    setAnimRows([...animRows, null]);
    setAnimRowsNoBg([...animRowsNoBg, null]);
  };

  const handleRemoveAnimation = (index: number) => {
    const newAnims = [...animations];
    newAnims.splice(index, 1);
    setAnimations(newAnims);
    
    const newRows = [...animRows];
    newRows.splice(index, 1);
    setAnimRows(newRows);
    
    const newRowsNoBg = [...animRowsNoBg];
    newRowsNoBg.splice(index, 1);
    setAnimRowsNoBg(newRowsNoBg);
  };

  const NavButton = ({ state, label, icon: Icon, active }: any) => (
    <button
      onClick={() => setAppState(state)}
      className={`flex items-center gap-2 px-4 py-2 border-2 border-zinc-800 font-black uppercase tracking-widest text-sm transition-all
        ${active ? 'bg-[#BDFF00] text-black shadow-[4px_4px_0_#BDFF00]' : 'bg-[#161616] text-[#E0E0E0] hover:-translate-y-1 hover:shadow-[4px_4px_0_#E0E0E0]'}`}
    >
      <Icon size={16} /> <span className="hidden md:inline">{label}</span>
    </button>
  );

  const getSpriteMetadata = () => {
    if (!compiledSpriteSheet) return null;
    const img = new Image();
    img.src = compiledSpriteSheet;
    const frameW = Math.floor(img.width / 4);
    const frameH = Math.floor(img.height / animations.length);
    return { sheetW: img.width, sheetH: img.height, frameW, frameH, rows: animations.length, cols: 4 };
  };

  const handleDownloadPNG = () => {
    if (!compiledSpriteSheet) return;
    const link = document.createElement('a');
    link.href = compiledSpriteSheet;
    link.download = 'spritesheet.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadJSON = () => {
    if (!compiledSpriteSheet) return;
    const meta = getSpriteMetadata();
    if (!meta) return;

    // Build TexturePacker-compatible JSON Hash atlas
    const frames: Record<string, any> = {};
    const animationTags: { name: string; from: number; to: number; direction: string }[] = [];
    let globalIdx = 0;

    animations.forEach((anim, rowIdx) => {
      const tagFrom = globalIdx;
      for (let col = 0; col < 4; col++) {
        const key = `${anim.name.toLowerCase()}_${col}`;
        frames[key] = {
          frame: { x: col * meta.frameW, y: rowIdx * meta.frameH, w: meta.frameW, h: meta.frameH },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: meta.frameW, h: meta.frameH },
          sourceSize: { w: meta.frameW, h: meta.frameH }
        };
        globalIdx++;
      }
      animationTags.push({ name: anim.name, from: tagFrom, to: globalIdx - 1, direction: 'forward' });
    });

    const atlas = {
      frames,
      animations: animations.reduce((acc, anim) => {
        acc[anim.name.toLowerCase()] = Array.from({ length: 4 }, (_, i) => `${anim.name.toLowerCase()}_${i}`);
        return acc;
      }, {} as Record<string, string[]>),
      meta: {
        app: 'Pixel Engine',
        version: '1.0',
        image: 'spritesheet.png',
        format: 'RGBA8888',
        size: { w: meta.sheetW, h: meta.sheetH },
        scale: '1',
        frameTags: animationTags,
        // Grid info for engines that support grid-based import (Unity, Godot)
        grid: { cellWidth: meta.frameW, cellHeight: meta.frameH, columns: 4, rows: meta.rows }
      }
    };

    const blob = new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'spritesheet.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-[#E0E0E0] font-sans selection:bg-[#BDFF00] selection:text-black">
      {/* Header / Nav */}
      <header className="border-b-4 border-zinc-800 bg-[#161616] p-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="font-black uppercase tracking-widest text-xl text-[#BDFF00] flex items-center gap-2">
            <Sparkles size={24} /> Pixel Engine
          </h1>
          <nav className="flex gap-4 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
            <NavButton state="CREATE_CHAR" label="1. Character" icon={ImageIcon} active={appState === 'CREATE_CHAR'} />
            <NavButton state="CREATE_ANIM" label="2. Animations" icon={RefreshCw} active={appState === 'CREATE_ANIM'} />
            <NavButton state="PLAY" label="3. Test & Export" icon={Play} active={appState === 'PLAY'} />
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4 py-8">
        {errorMsg && (
          <div className="bg-red-900/50 border-4 border-red-500 text-red-100 p-4 mb-8 flex items-start gap-4 shadow-[4px_4px_0_#ef4444]">
            <AlertCircle className="shrink-0 mt-1" />
            <div>
              <p className="font-black uppercase tracking-widest mb-1">Error</p>
              <p className="font-mono text-sm">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-auto hover:text-white"><XCircle size={20}/></button>
          </div>
        )}

        {appState === 'CREATE_CHAR' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[8px_8px_0_#BDFF00]">
              <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 gap-4">
                <h2 className="font-black uppercase tracking-widest text-2xl">Design your Hero</h2>
                <div className="relative">
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <button className="flex items-center gap-2 bg-zinc-800 text-white hover:bg-zinc-700 px-4 py-2 font-black uppercase tracking-widest text-sm transition-colors border-2 border-zinc-700">
                    <Upload size={16} /> Upload Image
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-4 mb-4">
                 <div className="h-[2px] bg-zinc-800 flex-1"></div>
                 <span className="text-zinc-500 font-black tracking-widest text-sm uppercase">OR</span>
                 <div className="h-[2px] bg-zinc-800 flex-1"></div>
              </div>

              <textarea
                value={charPrompt}
                onChange={e => setCharPrompt(e.target.value)}
                placeholder="Cyberpunk rogue with a glowing katana..."
                className="w-full bg-[#0D0D0D] border-2 border-zinc-800 p-4 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono mb-4 h-32 resize-none"
              />
              <button
                onClick={handleGenerateChar}
                disabled={isGenerating || !charPrompt.trim()}
                className="w-full bg-[#BDFF00] text-black font-black uppercase tracking-widest p-4 border-2 border-transparent hover:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isGenerating ? loadingMsg : 'Generate Base Character'}
              </button>
            </div>

            {baseCharImage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-[#161616] border-4 border-zinc-800 p-4 shadow-[4px_4px_0_#E0E0E0]">
                  <h3 className="font-black uppercase tracking-widest mb-4">Raw Generated</h3>
                  <img src={baseCharImage} alt="Base" className="w-full aspect-square object-contain bg-[#0D0D0D] border-2 border-zinc-800" style={{ imageRendering: 'pixelated' }} />
                </div>
                
                <div className="bg-[#161616] border-4 border-zinc-800 p-4 shadow-[4px_4px_0_#E0E0E0] flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-black uppercase tracking-widest text-sm sm:text-base">Cleaned Output</h3>
                    {baseCharNoBg && (
                      <button 
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = baseCharNoBg;
                          a.download = 'cleaned_hero.png';
                          a.click();
                        }}
                        className="p-2 bg-zinc-800 text-white hover:bg-zinc-700 transition-colors border-2 border-zinc-700 flex items-center justify-center"
                        title="Download Cleaned PNG"
                      >
                        <Download size={16} />
                      </button>
                    )}
                  </div>
                  {baseCharNoBg ? (
                     <div className="w-full aspect-square border-2 border-zinc-800 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')]">
                        <img src={baseCharNoBg} alt="Target" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                     </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center border-2 border-zinc-800 bg-[#0D0D0D]">
                      <button
                        onClick={handleRemoveBaseBg}
                        disabled={isGenerating}
                        className="bg-[#161616] border-2 border-[#E0E0E0] px-6 py-3 font-black uppercase tracking-widest hover:bg-[#E0E0E0] hover:text-black transition-colors disabled:opacity-50"
                      >
                        {isGenerating ? 'Processing...' : 'Remove Green BG'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {appState === 'CREATE_ANIM' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[8px_8px_0_#BDFF00] mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
               <div>
                 <h2 className="font-black uppercase tracking-widest text-2xl mb-2">Animation Slicer</h2>
                 <p className="text-zinc-400 font-mono text-sm max-w-2xl">
                   Generate 4-frame animations row by row. We do this to avoid AI quotas. Wait for each to finish before starting the next.
                 </p>
               </div>
               <button 
                 onClick={handleGenerateAllMissing}
                 disabled={isGenerating || !baseCharImage}
                 className="bg-zinc-800 text-white hover:bg-[#BDFF00] hover:text-black border-2 border-zinc-800 font-black uppercase tracking-widest text-sm px-6 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
               >
                 ⚡ Auto-Gen All Missing
               </button>
               <button 
                 onClick={handleRegenerateAll}
                 disabled={isGenerating || !baseCharImage}
                 className="bg-zinc-800 text-white hover:bg-orange-500 hover:text-black border-2 border-zinc-800 font-black uppercase tracking-widest text-sm px-6 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
               >
                 🔄 Re-Gen All
               </button>
             </div>

             <div className="space-y-4">
               {animations.map((animDef, i) => (
                 <div key={animDef.id} className="bg-[#161616] border-2 border-zinc-800 p-4 flex flex-col gap-4 hover:border-zinc-600 transition-colors">
                   <div className="flex flex-col md:flex-row items-center gap-4">
                     <div className="w-full md:w-32 shrink-0">
                        <input 
                           type="text" 
                           value={animDef.name} 
                           onChange={(e) => handleUpdateAnimation(i, 'name', e.target.value)}
                           className="w-full bg-[#0D0D0D] border-x-0 border-t-0 border-b-2 border-zinc-800 p-1 text-white font-black uppercase tracking-widest text-lg focus:outline-none focus:border-[#BDFF00]"
                        />
                     </div>
                     
                     <div className="flex-1 w-full bg-[#0D0D0D] border-2 border-zinc-900 border-dashed h-24 relative overflow-hidden flex items-center justify-center bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')]">
                       {animRowsNoBg[i] ? (
                         <img src={animRowsNoBg[i]!} alt={animDef.name} className="h-full w-auto object-contain" style={{ imageRendering: 'pixelated' }} />
                       ) : animRows[i] ? (
                         <img src={animRows[i]!} alt={animDef.name} className="h-full w-auto object-contain" style={{ imageRendering: 'pixelated' }} />
                       ) : (
                         <span className="text-zinc-700 font-mono text-xs uppercase">No Data</span>
                       )}
                     </div>

                     <div className="flex flex-col gap-2 shrink-0 w-full md:w-32">
                         <button
                           onClick={() => handleGenerateRow(i)}
                           disabled={isGenerating || !baseCharImage}
                           className="w-full bg-[#E0E0E0] text-black font-black uppercase tracking-widest px-4 py-3 border-2 border-transparent hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm whitespace-nowrap"
                         >
                           {animRows[i] ? 'Re-roll' : 'Generate'}
                         </button>
                         {i >= DEFAULT_ANIMATIONS.length && (
                             <button
                               onClick={() => handleRemoveAnimation(i)}
                               className="w-full bg-red-900/50 text-white font-black uppercase tracking-widest px-2 py-2 border-2 border-red-900 hover:bg-red-800 transition-colors flex items-center justify-center gap-2 text-xs"
                             >
                                <Trash2 size={14} /> Remove
                             </button>
                         )}
                     </div>
                   </div>
                   <div className="w-full">
                      <input 
                         type="text"
                         placeholder="Optional: Custom AI Prompt for this action (e.g. 'Throwing a fireball forward')"
                         value={animDef.customPrompt}
                         onChange={(e) => handleUpdateAnimation(i, 'customPrompt', e.target.value)}
                         className="w-full bg-[#0D0D0D] border-2 border-zinc-800 p-2 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-sm"
                      />
                   </div>
                 </div>
               ))}
               <button 
                  onClick={handleAddAnimation}
                  className="w-full border-2 border-dashed border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-400 p-4 font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors"
               >
                  <Plus size={20} /> Add Custom Action
               </button>
             </div>
          </div>
        )}

        {appState === 'PLAY' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[8px_8px_0_#BDFF00] mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
               <div>
                 <h2 className="font-black uppercase tracking-widest text-2xl mb-2">Test & Export</h2>
                 <p className="text-zinc-400 font-mono text-sm">Preview live, then export for your game engine.</p>
               </div>
            </div>

            {compiledSpriteSheet ? (
              <div className="flex flex-col gap-8">
                 <GameViewport 
                   spriteSheetData={compiledSpriteSheet} 
                   framesPerRow={4} 
                   totalRows={animations.length}
                 />

                 {/* Export Panel */}
                 <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[4px_4px_0_#BDFF00]">
                    <h3 className="font-black uppercase tracking-widest text-[#BDFF00] text-xl mb-6 flex items-center gap-2">
                      <Download size={20} /> Export for Game Engines
                    </h3>

                    {/* Download Buttons */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                      <button
                        onClick={handleDownloadPNG}
                        className="flex items-center gap-4 bg-[#0D0D0D] border-2 border-zinc-700 p-5 hover:border-[#BDFF00] hover:shadow-[4px_4px_0_#BDFF00] transition-all group"
                      >
                        <div className="w-12 h-12 bg-[#BDFF00]/10 border-2 border-[#BDFF00]/30 flex items-center justify-center shrink-0 group-hover:bg-[#BDFF00]/20">
                          <ImageIcon size={24} className="text-[#BDFF00]" />
                        </div>
                        <div className="text-left">
                          <div className="font-black uppercase tracking-widest text-white text-sm">Sprite Sheet PNG</div>
                          <div className="font-mono text-xs text-zinc-500 mt-1">Lossless image • Transparent background</div>
                        </div>
                      </button>

                      <button
                        onClick={handleDownloadJSON}
                        className="flex items-center gap-4 bg-[#0D0D0D] border-2 border-zinc-700 p-5 hover:border-[#BDFF00] hover:shadow-[4px_4px_0_#BDFF00] transition-all group"
                      >
                        <div className="w-12 h-12 bg-[#BDFF00]/10 border-2 border-[#BDFF00]/30 flex items-center justify-center shrink-0 group-hover:bg-[#BDFF00]/20">
                          <FileJson size={24} className="text-[#BDFF00]" />
                        </div>
                        <div className="text-left">
                          <div className="font-black uppercase tracking-widest text-white text-sm">JSON Atlas</div>
                          <div className="font-mono text-xs text-zinc-500 mt-1">Frame coordinates • Animation tags</div>
                        </div>
                      </button>
                    </div>

                    {/* Sprite Metadata */}
                    {(() => {
                      const meta = getSpriteMetadata();
                      if (!meta) return null;
                      return (
                        <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4 mb-8">
                          <h4 className="font-black uppercase tracking-widest text-xs text-zinc-400 mb-3 flex items-center gap-2">
                            <Info size={14} /> Sprite Sheet Info
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-[#161616] border border-zinc-800 p-3">
                              <div className="font-mono text-[#BDFF00] text-lg font-bold">{meta.frameW} × {meta.frameH}</div>
                              <div className="text-zinc-500 text-xs font-mono uppercase">Frame Size</div>
                            </div>
                            <div className="bg-[#161616] border border-zinc-800 p-3">
                              <div className="font-mono text-[#BDFF00] text-lg font-bold">{meta.cols} × {meta.rows}</div>
                              <div className="text-zinc-500 text-xs font-mono uppercase">Grid (C × R)</div>
                            </div>
                            <div className="bg-[#161616] border border-zinc-800 p-3">
                              <div className="font-mono text-[#BDFF00] text-lg font-bold">{meta.sheetW} × {meta.sheetH}</div>
                              <div className="text-zinc-500 text-xs font-mono uppercase">Sheet Size</div>
                            </div>
                            <div className="bg-[#161616] border border-zinc-800 p-3">
                              <div className="font-mono text-[#BDFF00] text-lg font-bold">{meta.cols * meta.rows}</div>
                              <div className="text-zinc-500 text-xs font-mono uppercase">Total Frames</div>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {animations.map((a, i) => (
                              <span key={a.id} className="bg-[#161616] border border-zinc-800 px-2 py-1 font-mono text-xs text-zinc-400">
                                <span className="text-[#BDFF00]">Row {i}</span> {a.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Engine Usage Guide */}
                    <h4 className="font-black uppercase tracking-widest text-xs text-zinc-400 mb-3 flex items-center gap-2">
                      <Gamepad2 size={14} /> How to Use in Game Engines
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Monitor size={14} className="text-[#BDFF00]" />
                          <span className="font-black uppercase tracking-widest text-sm text-white">Unity</span>
                        </div>
                        <p className="font-mono text-xs text-zinc-500 leading-relaxed">
                          Import PNG → Texture Type: "Sprite" → Sprite Mode: "Multiple" → Sprite Editor → Slice → Grid by Cell Size → Apply.
                        </p>
                      </div>
                      <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Monitor size={14} className="text-[#BDFF00]" />
                          <span className="font-black uppercase tracking-widest text-sm text-white">Godot</span>
                        </div>
                        <p className="font-mono text-xs text-zinc-500 leading-relaxed">
                          AnimatedSprite2D → SpriteFrames → Add from Sheet → Select PNG → Set grid size → Pick frames per animation.
                        </p>
                      </div>
                      <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Monitor size={14} className="text-[#BDFF00]" />
                          <span className="font-black uppercase tracking-widest text-sm text-white">Phaser / PixiJS</span>
                        </div>
                        <p className="font-mono text-xs text-zinc-500 leading-relaxed">
                          Download both files → <code className="text-[#BDFF00]">this.load.atlas('hero', 'spritesheet.png', 'spritesheet.json')</code>
                        </p>
                      </div>
                      <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Monitor size={14} className="text-[#BDFF00]" />
                          <span className="font-black uppercase tracking-widest text-sm text-white">GameMaker / Other</span>
                        </div>
                        <p className="font-mono text-xs text-zinc-500 leading-relaxed">
                          Import PNG as grid-based sprite sheet. Use the frame size and row mapping shown above.
                        </p>
                      </div>
                    </div>
                 </div>
              </div>
            ) : (
              <div className="bg-[#161616] border-2 border-zinc-800 border-dashed p-12 text-center text-zinc-500 font-mono">
                No sprite sheet compiled yet.<br/>Generate at least one animation row in Step 2.
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Loader Overlay */}
      {isGenerating && (
         <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-sm">
           <div className="bg-[#161616] border-4 border-zinc-800 p-8 shadow-[8px_8px_0_#BDFF00] flex flex-col items-center gap-4 max-w-sm w-full mx-4 text-center">
              <RefreshCw className="animate-spin text-[#BDFF00]" size={48} />
              <div className="font-black uppercase tracking-widest text-[#BDFF00] text-xl">Thinking...</div>
              <p className="font-mono text-sm text-zinc-400">{loadingMsg}</p>
           </div>
         </div>
      )}
    </div>
  );
}

