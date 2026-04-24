import { useState, type ChangeEvent } from 'react';
import { generateCharacter, generateAnimationRow, AnimationRowResult, regenerateSingleFrame, combineFramesIntoStrip, ArtStyle, ART_STYLES, Perspective, PERSPECTIVES, generateCharacterBatch } from './services/ai';
import { removeBackground, normalizeCharacterSize } from './lib/imageUtils';
import { compileSpriteSheet } from './lib/spriteCompiler';
import { GameViewport } from './components/GameViewport';
import { AlertCircle, Image as ImageIcon, Play, RefreshCw, XCircle, Upload, Download, Plus, Trash2, FileJson, Monitor, Gamepad2, Info, Check, ChevronRight, Users, Eye, FolderPlus, ChevronDown, Pencil } from 'lucide-react';
import { PERSPECTIVE_IMAGES, STYLE_IMAGES, PERSPECTIVE_TIPS, STYLE_TIPS } from './components/StyleIcons';

const DEFAULT_ANIMATIONS = [
  { name: "Idle" },
  { name: "Walk" },
  { name: "Run" },
  { name: "Attack" },
  { name: "Jump" },
  { name: "Hurt" },
  { name: "Death" }
];

const makeDefaultAnims = () => DEFAULT_ANIMATIONS.map((anim, i) => ({ id: `default-${i}`, name: anim.name, customPrompt: '' }));

interface SavedCharacter {
  id: string;
  name: string;
  prompt: string;
  group: string;
  artStyle: ArtStyle;
  perspective: Perspective;
  rawImage: string;
  cleanImage: string;
  animations: { id: string; name: string; customPrompt: string }[];
  animRows: (AnimationRowResult | null)[];
  animRowsNoBg: (string | null)[];
  spriteSheet: string | null;
}

type AppState = 'CREATE_CHAR' | 'CREATE_ANIM' | 'PLAY';

export default function App() {
  const [appState, setAppState] = useState<AppState>('CREATE_CHAR');

  // --- Character gallery ---
  const [savedChars, setSavedChars] = useState<SavedCharacter[]>([]);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);

  // --- Creation form ---
  const [charPrompt, setCharPrompt] = useState('');
  const [artStyle, setArtStyle] = useState<ArtStyle>('pixel');
  const [perspective, setPerspective] = useState<Perspective>('platformer');
  const [batchMode, setBatchMode] = useState(false);
  const [batchContext, setBatchContext] = useState('');
  const [batchNames, setBatchNames] = useState('');

  // Derived active character
  const activeChar = savedChars.find(c => c.id === activeCharId) || null;

  // Convenience updater for the active character
  const updateActiveChar = (patch: Partial<SavedCharacter>) => {
    setSavedChars(prev => prev.map(c => c.id === activeCharId ? { ...c, ...patch } : c));
  };

  // Aliases for active character data (keeps handler code concise)
  const animations = activeChar?.animations ?? makeDefaultAnims();
  const animRows = activeChar?.animRows ?? [];
  const animRowsNoBg = activeChar?.animRowsNoBg ?? [];
  const compiledSpriteSheet = activeChar?.spriteSheet ?? null;

  const [selectedFrame, setSelectedFrame] = useState<{ rowIndex: number, frameIndex: number, url: string } | null>(null);
  const [previewChar, setPreviewChar] = useState<SavedCharacter | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [dragCharId, setDragCharId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState('');
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameGroupVal, setRenameGroupVal] = useState('');
  const [renamingChar, setRenamingChar] = useState<string | null>(null);
  const [renameCharVal, setRenameCharVal] = useState('');

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

  const toggleGroup = (g: string) => setCollapsedGroups(prev => { const s = new Set(prev); s.has(g) ? s.delete(g) : s.add(g); return s; });

  const moveCharToGroup = (charId: string, group: string) => {
    setSavedChars(prev => prev.map(c => c.id === charId ? { ...c, group } : c));
  };

  const groupedChars = () => {
    const groups: Record<string, SavedCharacter[]> = {};
    for (const g of emptyGroups) groups[g] ??= [];
    for (const c of savedChars) (groups[c.group] ??= []).push(c);
    return groups;
  };

  const createGroup = () => {
    const name = newGroupInput.trim();
    if (!name) return;
    setEmptyGroups(prev => prev.includes(name) ? prev : [...prev, name]);
    setNewGroupInput('');
    setShowNewGroup(false);
  };

  const renameGroup = (oldName: string) => {
    const newName = renameGroupVal.trim();
    if (!newName || newName === oldName) { setRenamingGroup(null); return; }
    setSavedChars(prev => prev.map(c => c.group === oldName ? { ...c, group: newName } : c));
    setEmptyGroups(prev => prev.map(g => g === oldName ? newName : g));
    setRenamingGroup(null);
  };

  const deleteGroup = (group: string) => {
    setSavedChars(prev => prev.map(c => c.group === group ? { ...c, group: 'Ungrouped' } : c));
    setEmptyGroups(prev => prev.filter(g => g !== group));
  };

  const renameChar = (charId: string) => {
    const name = renameCharVal.trim();
    if (!name) { setRenamingChar(null); return; }
    setSavedChars(prev => prev.map(c => c.id === charId ? { ...c, name } : c));
    setRenamingChar(null);
  };

  const allGroupNames = Object.keys(groupedChars());

  const addCharToGallery = (raw: string, clean: string, prompt: string, group = 'Ungrouped', charName?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    const name = charName || prompt.slice(0, 30) || 'Uploaded Hero';
    const char: SavedCharacter = {
      id, name, prompt, group, artStyle, perspective, rawImage: raw, cleanImage: clean,
      animations: makeDefaultAnims(),
      animRows: Array(7).fill(null), animRowsNoBg: Array(7).fill(null), spriteSheet: null,
    };
    setSavedChars(prev => [char, ...prev]);
    setActiveCharId(id);
    setCharPrompt('');
  };

  const handleGenerateChar = async () => {
    if (!charPrompt.trim()) return;
    setIsGenerating(true);
    setErrorMsg(null);
    setLoadingMsg("Generating base character...");
    try {
      const b64 = await generateCharacter(charPrompt, artStyle, perspective);
      setLoadingMsg("Removing green background...");
      const noBg = await removeBackground(b64, 70);
      setLoadingMsg("Normalizing size...");
      const normalized = await normalizeCharacterSize(noBg);
      addCharToGallery(b64, normalized, charPrompt);
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBatchGenerate = async () => {
    const names = batchNames.split('\n').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setIsGenerating(true);
    setErrorMsg(null);
    const groupName = batchContext.trim() || 'Batch ' + new Date().toLocaleTimeString();
    setEmptyGroups(prev => prev.includes(groupName) ? prev : [...prev, groupName]);
    try {
      const results = await generateCharacterBatch(names, batchContext, artStyle, perspective, (msg) => setLoadingMsg(msg));
      for (const r of results) {
        setLoadingMsg(`Cleaning ${r.name}...`);
        const noBg = await removeBackground(r.dataUrl, 70);
        const normalized = await normalizeCharacterSize(noBg);
        addCharToGallery(r.dataUrl, normalized, r.name, groupName, r.name);
      }
      setBatchNames('');
      setBatchContext('');
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErrorMsg('Please upload a valid image file.'); return; }
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (!event.target?.result) return;
      const raw = event.target.result as string;
      setIsGenerating(true);
      setLoadingMsg("Removing green background...");
      try {
        const noBg = await removeBackground(raw, 70);
        const normalized = await normalizeCharacterSize(noBg);
        addCharToGallery(raw, normalized, 'Uploaded Hero');
      } catch { addCharToGallery(raw, raw, 'Uploaded Hero'); }
      finally { setIsGenerating(false); }
    };
    reader.onerror = () => setErrorMsg('Failed to read file.');
    reader.readAsDataURL(file);
  };

  const handleDeleteChar = (id: string) => {
    setSavedChars(prev => prev.filter(c => c.id !== id));
    if (activeCharId === id) setActiveCharId(null);
  };

  const handleSelectChar = (id: string) => {
    setActiveCharId(id);
    setAppState('CREATE_ANIM');
  };

  const handleGenerateRow = async (rowIndex: number) => {
    if (!activeChar) return;
    setIsGenerating(true);
    setErrorMsg(null);
    const animDef = activeChar.animations[rowIndex];
    setLoadingMsg(`Generating ${animDef.name} animation...`);
    try {
      const sourceImage = activeChar.cleanImage;
      const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective);

      const newRows = [...activeChar.animRows];
      newRows[rowIndex] = b64;
      const newRowsNoBg = [...activeChar.animRowsNoBg];
      newRowsNoBg[rowIndex] = b64.rowUrl;

      setLoadingMsg("Compiling Sprite Sheet...");
      const compiled = await compileSpriteSheet(newRowsNoBg, 4, activeChar.cleanImage || undefined);
      updateActiveChar({ animRows: newRows, animRowsNoBg: newRowsNoBg, spriteSheet: compiled });
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateSingleFrame = async (rowIndex: number, frameIndex: number) => {
    if (!activeChar) return;
    setIsGenerating(true);
    setErrorMsg(null);
    const animDef = activeChar.animations[rowIndex];
    setLoadingMsg(`Regenerating ${animDef.name} frame ${frameIndex + 1}...`);
    try {
      const sourceImage = activeChar.cleanImage;
      const newFrameUrl = await regenerateSingleFrame(sourceImage, animDef.name, animDef.customPrompt, frameIndex, (msg) => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective);

      const newRows = [...activeChar.animRows];
      const row = newRows[rowIndex]!;
      const newFramesUrls = [...row.framesUrls];
      newFramesUrls[frameIndex] = newFrameUrl;

      setLoadingMsg("Recombining frames...");
      const newRowUrl = await combineFramesIntoStrip(newFramesUrls);
      newRows[rowIndex] = { rowUrl: newRowUrl, framesUrls: newFramesUrls };

      const newRowsNoBg = [...activeChar.animRowsNoBg];
      newRowsNoBg[rowIndex] = newRowUrl;

      setSelectedFrame(prev => prev ? { ...prev, url: newFrameUrl } : null);

      setLoadingMsg("Compiling Sprite Sheet...");
      const compiled = await compileSpriteSheet(newRowsNoBg, 4, activeChar.cleanImage || undefined);
      updateActiveChar({ animRows: newRows, animRowsNoBg: newRowsNoBg, spriteSheet: compiled });
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAllMissing = async () => {
    if (!activeChar) return;
    setIsGenerating(true);
    setErrorMsg(null);

    let currentRows = [...activeChar.animRows];
    let currentRowsNoBg = [...activeChar.animRowsNoBg];

    try {
      const sourceImage = activeChar.cleanImage;
      for (let i = 0; i < activeChar.animations.length; i++) {
        if (!currentRows[i]) {
          const animDef = activeChar.animations[i];
          setLoadingMsg(`Generating ${animDef.name} (${i + 1}/${activeChar.animations.length})...`);

          const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective);
          currentRows[i] = b64;
          currentRowsNoBg[i] = b64.rowUrl;
          updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg] });

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setLoadingMsg("Compiling final Sprite Sheet...");
      const compiled = await compileSpriteSheet(currentRowsNoBg, 4, activeChar.cleanImage || undefined);
      updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg], spriteSheet: compiled });
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!activeChar) return;
    updateActiveChar({ animRows: [], animRowsNoBg: [], spriteSheet: null });
    setIsGenerating(true);
    setErrorMsg(null);

    const currentRows: (AnimationRowResult | null)[] = [];
    const currentRowsNoBg: (string | null)[] = [];

    try {
      const sourceImage = activeChar.cleanImage;
      for (let i = 0; i < activeChar.animations.length; i++) {
        const animDef = activeChar.animations[i];
        setLoadingMsg(`Re-generating ${animDef.name} (${i + 1}/${activeChar.animations.length})...`);

        const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, (msg) => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective);
        currentRows[i] = b64;
        currentRowsNoBg[i] = b64.rowUrl;
        updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg] });

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setLoadingMsg("Compiling final Sprite Sheet...");
      const compiled = await compileSpriteSheet(currentRowsNoBg, 4, activeChar.cleanImage || undefined);
      updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg], spriteSheet: compiled });
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateAnimation = (index: number, field: 'name' | 'customPrompt', value: string) => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations];
    newAnims[index] = { ...newAnims[index], [field]: value };
    updateActiveChar({ animations: newAnims });
  };

  const handleAddAnimation = () => {
    if (!activeChar) return;
    updateActiveChar({
      animations: [...activeChar.animations, { id: Math.random().toString(), name: 'Custom Action', customPrompt: '' }],
      animRows: [...activeChar.animRows, null],
      animRowsNoBg: [...activeChar.animRowsNoBg, null],
    });
  };

  const handleRemoveAnimation = (index: number) => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations]; newAnims.splice(index, 1);
    const newRows = [...activeChar.animRows]; newRows.splice(index, 1);
    const newRowsNoBg = [...activeChar.animRowsNoBg]; newRowsNoBg.splice(index, 1);
    updateActiveChar({ animations: newAnims, animRows: newRows, animRowsNoBg: newRowsNoBg });
  };

  const StepBtn = ({ step, state, label, icon: Icon, active, disabled, count, total }: any) => (
    <button
      onClick={() => !disabled && setAppState(state)}
      className={`flex items-center gap-2 px-3 py-2 border-2 font-black uppercase tracking-widest text-xs transition-all shrink-0
        ${disabled ? 'opacity-30 cursor-not-allowed border-zinc-800' : ''}
        ${active ? 'bg-[#BDFF00] text-black border-[#BDFF00]' : 'bg-[#161616] text-[#E0E0E0] border-zinc-800 hover:border-zinc-600'}`}
    >
      <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-black border ${active ? 'border-black' : 'border-zinc-600'}`}>{step}</span>
      <Icon size={14} />
      <span className="hidden sm:inline">{label}</span>
      {count !== undefined && <span className={`font-mono text-[10px] ${active ? 'text-black/60' : 'text-zinc-500'}`}>{total ? `${count}/${total}` : count || ''}</span>}
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
        <div className="max-w-7xl mx-auto flex items-center gap-6">
          <h1 className="font-black uppercase tracking-widest text-lg text-[#BDFF00] shrink-0">
            Pixel Engine
          </h1>
          {/* Stepper nav */}
          <nav className="flex items-center gap-0 flex-1 min-w-0">
            <StepBtn step={1} state="CREATE_CHAR" label="Characters" icon={Users} active={appState === 'CREATE_CHAR'} count={savedChars.length} />
            <div className={`h-[2px] w-8 shrink-0 ${activeChar ? 'bg-[#BDFF00]' : 'bg-zinc-800'}`} />
            <StepBtn step={2} state="CREATE_ANIM" label="Animations" icon={RefreshCw} active={appState === 'CREATE_ANIM'} disabled={!activeChar} count={animRows.filter(Boolean).length} total={animations.length} />
            <div className={`h-[2px] w-8 shrink-0 ${compiledSpriteSheet ? 'bg-[#BDFF00]' : 'bg-zinc-800'}`} />
            <StepBtn step={3} state="PLAY" label="Export" icon={Play} active={appState === 'PLAY'} disabled={!activeChar} />
          </nav>
          {activeChar && appState !== 'CREATE_CHAR' && (
            <div className="hidden lg:flex items-center gap-2 shrink-0 bg-[#0D0D0D] border border-zinc-800 px-3 py-1.5">
              <img src={activeChar.cleanImage} alt="" className="w-7 h-7 object-contain" style={{ imageRendering: 'pixelated' }} />
              <span className="font-mono text-xs text-zinc-400 truncate max-w-[120px]">{activeChar.name}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 py-6">
        {errorMsg && (
          <div className="bg-red-900/50 border-4 border-red-500 text-red-100 p-4 mb-6 flex items-start gap-4">
            <AlertCircle className="shrink-0 mt-1" />
            <div className="flex-1">
              <p className="font-black uppercase tracking-widest mb-1 text-sm">Error</p>
              <p className="font-mono text-xs">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-auto hover:text-white"><XCircle size={18} /></button>
          </div>
        )}

        {appState === 'CREATE_CHAR' && (
          <div className="flex flex-col lg:flex-row gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* LEFT: Creation Panel */}
            <div className="lg:w-[380px] shrink-0 space-y-4">
              <div className="bg-[#161616] border-2 border-zinc-800 p-4">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="font-black uppercase tracking-widest text-lg">New Hero</h2>
                  <div className="relative">
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <button className="flex items-center gap-1.5 bg-zinc-800 text-white hover:bg-zinc-700 px-3 py-1.5 font-black uppercase tracking-widest text-[10px] transition-colors border border-zinc-700">
                      <Upload size={12} /> Upload
                    </button>
                  </div>
                </div>

                {/* Perspective */}
                <label className="block font-black uppercase tracking-widest text-[10px] text-zinc-500 mb-2">Perspective</label>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {PERSPECTIVES.map(p => (
                    <button key={p.id} onClick={() => setPerspective(p.id)}
                      className={`p-1.5 border-2 transition-all flex flex-col items-center h-24 ${perspective === p.id ? 'border-[#BDFF00] bg-[#BDFF00]/10 text-white' : 'border-zinc-800 bg-[#0D0D0D] text-zinc-500 hover:border-zinc-600'}`}>
                      {p.popular && <span className="text-[6px] font-mono text-[#BDFF00] uppercase leading-none">Popular</span>}
                      <div className="flex-1 flex items-center justify-center overflow-hidden">
                        <img src={PERSPECTIVE_IMAGES[p.id]} alt={p.label} className="w-10 h-10 object-contain" style={{ imageRendering: 'pixelated' }} />
                      </div>
                      <span className="font-black uppercase tracking-widest text-[8px] mt-auto shrink-0">{p.label}</span>
                    </button>
                  ))}
                </div>

                {/* Art Style */}
                <label className="block font-black uppercase tracking-widest text-[10px] text-zinc-500 mb-2">Art Style</label>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {ART_STYLES.map(s => (
                    <button key={s.id} onClick={() => setArtStyle(s.id)}
                      className={`p-1.5 border-2 transition-all flex flex-col items-center h-24 ${artStyle === s.id ? 'border-[#BDFF00] bg-[#BDFF00]/10 text-white' : 'border-zinc-800 bg-[#0D0D0D] text-zinc-500 hover:border-zinc-600'}`}>
                      <div className="flex-1 flex items-center justify-center overflow-hidden">
                        <img src={STYLE_IMAGES[s.id]} alt={s.label} className="w-10 h-10 object-contain" style={{ imageRendering: 'pixelated' }} />
                      </div>
                      <span className="font-black uppercase tracking-widest text-[8px] mt-auto shrink-0">{s.label}</span>
                    </button>
                  ))}
                </div>

                {/* Info bar */}
                <div className="bg-[#0D0D0D] border border-zinc-800 p-2 mb-3">
                  <p className="font-mono text-[9px] text-zinc-600 leading-relaxed">
                    <span className="text-[#BDFF00]">{PERSPECTIVES.find(p=>p.id===perspective)?.label}</span> -- {PERSPECTIVE_TIPS[perspective]?.split('.')[0]}.
                    <br/><span className="text-[#BDFF00]">{ART_STYLES.find(s=>s.id===artStyle)?.label}</span> -- {STYLE_TIPS[artStyle]?.split('.')[0]}.
                  </p>
                </div>

                {/* Mode toggle */}
                <div className="flex gap-1.5 mb-3">
                  <button onClick={() => setBatchMode(false)}
                    className={`flex-1 py-1.5 font-black uppercase tracking-widest text-[10px] border-2 transition-all ${!batchMode ? 'bg-[#BDFF00] text-black border-[#BDFF00]' : 'bg-[#0D0D0D] text-zinc-500 border-zinc-800 hover:border-zinc-600'}`}>
                    Single
                  </button>
                  <button onClick={() => setBatchMode(true)}
                    className={`flex-1 py-1.5 font-black uppercase tracking-widest text-[10px] border-2 transition-all ${batchMode ? 'bg-[#BDFF00] text-black border-[#BDFF00]' : 'bg-[#0D0D0D] text-zinc-500 border-zinc-800 hover:border-zinc-600'}`}>
                    Batch
                  </button>
                </div>

                {/* Prompt inputs */}
                {!batchMode ? (
                  <>
                    <textarea value={charPrompt} onChange={e => setCharPrompt(e.target.value)}
                      placeholder="Cyberpunk rogue with a glowing katana..."
                      className="w-full bg-[#0D0D0D] border-2 border-zinc-800 p-3 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-sm mb-3 h-20 resize-none" />
                    <button onClick={handleGenerateChar} disabled={isGenerating || !charPrompt.trim()}
                      className="w-full bg-[#BDFF00] text-black font-black uppercase tracking-widest p-3 text-sm border-2 border-transparent hover:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                      {isGenerating ? loadingMsg : 'Generate'}
                    </button>
                  </>
                ) : (
                  <>
                    <input value={batchContext} onChange={e => setBatchContext(e.target.value)}
                      placeholder="Universe (e.g. Naruto, Marvel...)"
                      className="w-full bg-[#0D0D0D] border-2 border-zinc-800 p-2 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-xs mb-2" />
                    <textarea value={batchNames} onChange={e => setBatchNames(e.target.value)}
                      placeholder={"One per line:\nNaruto Uzumaki\nSasuke Uchiha\nSakura Haruno"}
                      className="w-full bg-[#0D0D0D] border-2 border-zinc-800 p-3 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-xs mb-2 h-24 resize-none" />
                    <p className="font-mono text-[10px] text-zinc-600 mb-3">{batchNames.split('\n').filter(s => s.trim()).length} character(s)</p>
                    <button onClick={handleBatchGenerate} disabled={isGenerating || !batchNames.split('\n').some(s => s.trim())}
                      className="w-full bg-[#BDFF00] text-black font-black uppercase tracking-widest p-3 text-sm border-2 border-transparent hover:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                      {isGenerating ? loadingMsg : `Generate ${batchNames.split('\n').filter(s => s.trim()).length}`}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* RIGHT: Gallery */}
            <div className="flex-1 min-w-0">
              {savedChars.length > 0 ? (
                <>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-black uppercase tracking-widest text-xl flex items-center gap-2">
                    <Users size={20} /> Your Heroes <span className="text-zinc-500 text-sm font-mono">({savedChars.length})</span>
                  </h2>
                  {showNewGroup ? (
                    <div className="flex gap-1 ml-auto">
                      <input value={newGroupInput} onChange={e => setNewGroupInput(e.target.value)} placeholder="Group name..."
                        autoFocus
                        className="bg-[#0D0D0D] border-2 border-zinc-700 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#BDFF00] w-40"
                        onKeyDown={e => { if (e.key === 'Enter') createGroup(); if (e.key === 'Escape') setShowNewGroup(false); }} />
                      <button onClick={createGroup} className="px-2 py-1.5 bg-[#BDFF00] text-black text-xs font-black border-2 border-[#BDFF00]"><Check size={12} /></button>
                      <button onClick={() => setShowNewGroup(false)} className="px-2 py-1.5 bg-zinc-800 text-zinc-400 text-xs border-2 border-zinc-700"><XCircle size={12} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewGroup(true)}
                      className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white border-2 border-zinc-700 hover:border-zinc-500 font-black uppercase tracking-widest text-xs transition-colors">
                      <FolderPlus size={12} /> New Group
                    </button>
                  )}
                </div>
                {Object.entries(groupedChars()).map(([group, chars]) => (
                  <div key={group} className="mb-4">
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOverGroup(group); }}
                      onDragLeave={() => setDragOverGroup(null)}
                      onDrop={e => { e.preventDefault(); if (dragCharId) { moveCharToGroup(dragCharId, group); setDragCharId(null); } setDragOverGroup(null); }}
                      className={`flex items-center gap-2 w-full text-left mb-2 py-2 px-3 bg-[#161616] border-2 transition-colors ${dragOverGroup === group ? 'border-[#BDFF00] bg-[#BDFF00]/10' : 'border-zinc-800 hover:border-zinc-600'}`}>
                      <button onClick={() => toggleGroup(group)} className="flex items-center gap-2 flex-1 min-w-0">
                        {collapsedGroups.has(group) ? <ChevronRight size={14} className="text-zinc-500 shrink-0" /> : <ChevronDown size={14} className="text-zinc-500 shrink-0" />}
                        {renamingGroup === group ? (
                          <input value={renameGroupVal} onChange={e => setRenameGroupVal(e.target.value)} autoFocus
                            className="bg-[#0D0D0D] border border-zinc-700 px-2 py-0.5 text-sm font-black uppercase tracking-widest text-[#BDFF00] focus:outline-none focus:border-[#BDFF00] w-40"
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => { if (e.key === 'Enter') renameGroup(group); if (e.key === 'Escape') setRenamingGroup(null); }}
                            onBlur={() => renameGroup(group)} />
                        ) : (
                          <span className="font-black uppercase tracking-widest text-sm text-[#BDFF00] truncate">{group}</span>
                        )}
                        <span className="font-mono text-xs text-zinc-500 shrink-0">({chars.length})</span>
                      </button>
                      {dragCharId && <span className="font-mono text-[10px] text-[#BDFF00] uppercase shrink-0">Drop here</span>}
                      {!dragCharId && group !== 'Ungrouped' && renamingGroup !== group && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={e => { e.stopPropagation(); setRenamingGroup(group); setRenameGroupVal(group); }}
                            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors" title="Rename group"><Pencil size={12} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteGroup(group); }}
                            className="p-1 text-zinc-600 hover:text-red-400 transition-colors" title="Delete group"><Trash2 size={12} /></button>
                        </div>
                      )}
                    </div>
                    {!collapsedGroups.has(group) && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pl-2">
                        {chars.map(c => (
                          <div key={c.id} draggable
                            onDragStart={() => setDragCharId(c.id)}
                            onDragEnd={() => { setDragCharId(null); setDragOverGroup(null); }}
                            className={`bg-[#161616] border-2 p-2 transition-all relative cursor-grab active:cursor-grabbing ${c.id === activeCharId ? 'border-[#BDFF00] shadow-[4px_4px_0_#BDFF00]' : 'border-zinc-800 hover:border-zinc-600'} ${dragCharId === c.id ? 'opacity-40' : ''}`}>
                            <div className="aspect-square bg-[#0D0D0D] border border-zinc-800 mb-2 flex items-center justify-center overflow-hidden cursor-pointer bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')]"
                              onClick={() => setPreviewChar(c)}>
                              <img src={c.cleanImage} alt={c.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                              <div className="absolute top-3 right-3 bg-black/60 p-1 rounded opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                                <Eye size={12} className="text-white" />
                              </div>
                            </div>
                            {renamingChar === c.id ? (
                              <input value={renameCharVal} onChange={e => setRenameCharVal(e.target.value)} autoFocus
                                className="w-full bg-[#0D0D0D] border border-zinc-700 px-1 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-[#BDFF00] mb-2"
                                onKeyDown={e => { if (e.key === 'Enter') renameChar(c.id); if (e.key === 'Escape') setRenamingChar(null); }}
                                onBlur={() => renameChar(c.id)} />
                            ) : (
                              <p className="font-mono text-xs text-zinc-400 truncate mb-2 cursor-pointer hover:text-zinc-200 transition-colors"
                                title="Click to rename" onClick={() => { setRenamingChar(c.id); setRenameCharVal(c.name); }}>{c.name}</p>
                            )}
                            <div className="flex gap-1">
                              <button onClick={() => handleSelectChar(c.id)}
                                className={`flex-1 text-xs font-black uppercase tracking-widest py-1.5 border transition-colors ${c.id === activeCharId ? 'bg-[#BDFF00] text-black border-[#BDFF00]' : 'bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700'}`}>
                                {c.id === activeCharId ? <span className="flex items-center justify-center gap-1"><Check size={12} /> Active</span> : <span className="flex items-center justify-center gap-1"><ChevronRight size={12} /> Select</span>}
                              </button>
                              <button onClick={() => handleDeleteChar(c.id)}
                                className="px-2 py-1.5 bg-zinc-800 text-red-400 border border-zinc-700 hover:bg-red-900 hover:text-white transition-colors">
                                <Trash2 size={12} />
                              </button>
                            </div>
                            {/* Move to group dropdown */}
                            <select value={c.group} onChange={e => moveCharToGroup(c.id, e.target.value)}
                              className="mt-2 w-full bg-[#0D0D0D] border border-zinc-800 px-1 py-1 text-[10px] font-mono text-zinc-500 focus:outline-none focus:border-[#BDFF00] cursor-pointer">
                              {allGroupNames.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
              ) : (
                <div className="flex-1 flex items-center justify-center border-2 border-dashed border-zinc-800 p-16">
                  <div className="text-center">
                    <Users size={48} className="text-zinc-800 mx-auto mb-4"/>
                    <p className="font-black uppercase tracking-widest text-zinc-600 mb-2">No Heroes Yet</p>
                    <p className="font-mono text-xs text-zinc-700">Generate or upload your first character using the panel on the left.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {appState === 'CREATE_ANIM' && activeChar && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#161616] border-2 border-zinc-800 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <img src={activeChar.cleanImage} alt="" className="w-12 h-12 object-contain bg-[#0D0D0D] border border-zinc-800 p-1" style={{ imageRendering: 'pixelated' }} />
                <div>
                  <h2 className="font-black uppercase tracking-widest text-xl">{activeChar.name}</h2>
                  <p className="font-mono text-[10px] text-zinc-500">{ART_STYLES.find(s => s.id === activeChar.artStyle)?.label} / {PERSPECTIVES.find(p => p.id === activeChar.perspective)?.label} -- <span className="text-[#BDFF00]">{animRows.filter(Boolean).length}/{animations.length} animations</span></p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAppState('CREATE_CHAR')} className="text-zinc-500 hover:text-white font-mono text-xs uppercase border border-zinc-700 px-3 py-2 hover:border-zinc-500 transition-colors">Switch Hero</button>
                <button onClick={handleGenerateAllMissing} disabled={isGenerating}
                  className="bg-zinc-800 text-white hover:bg-[#BDFF00] hover:text-black border-2 border-zinc-800 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                  Auto-Gen Missing
                </button>
                <button onClick={handleRegenerateAll} disabled={isGenerating}
                  className="bg-zinc-800 text-white hover:bg-orange-500 hover:text-black border-2 border-zinc-800 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                  Re-Gen All
                </button>
              </div>
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
                      {animRows[i] ? (
                        <div className="flex gap-2 sm:gap-4 h-full py-2">
                          {animRows[i]!.framesUrls.map((fUrl, fIdx) => (
                            <img
                              key={fIdx}
                              src={fUrl}
                              alt={`Frame ${fIdx + 1}`}
                              className="h-full w-auto object-contain cursor-pointer hover:scale-110 transition-transform"
                              style={{ imageRendering: 'pixelated' }}
                              onClick={() => setSelectedFrame({ rowIndex: i, frameIndex: fIdx, url: fUrl })}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-700 font-mono text-xs uppercase">No Data</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 shrink-0 w-full md:w-32">
                      <button
                        onClick={() => handleGenerateRow(i)}
                        disabled={isGenerating}
                        className="w-full bg-[#E0E0E0] text-black font-black uppercase tracking-widest px-4 py-3 border-2 border-transparent hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm whitespace-nowrap"
                      >
                        {animRows[i] ? 'Re-roll' : 'Generate'}
                      </button>
                      {i >= DEFAULT_ANIMATIONS.length && !animRows[i] && (
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

              {compiledSpriteSheet && (
                <button onClick={() => setAppState('PLAY')}
                  className="w-full bg-[#BDFF00] text-black font-black uppercase tracking-widest p-4 border-2 border-transparent hover:border-white transition-all flex items-center justify-center gap-2 mt-4">
                  <Play size={18} /> Continue to Test & Export
                </button>
              )}
            </div>
          </div>
        )}

        {appState === 'PLAY' && activeChar && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#161616] border-2 border-zinc-800 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <img src={activeChar.cleanImage} alt="" className="w-12 h-12 object-contain bg-[#0D0D0D] border border-zinc-800 p-1" style={{ imageRendering: 'pixelated' }} />
                <div>
                  <h2 className="font-black uppercase tracking-widest text-xl">{activeChar.name}</h2>
                  <p className="font-mono text-[10px] text-zinc-500">Test & Export</p>
                </div>
              </div>
              <button onClick={() => setAppState('CREATE_ANIM')} className="text-zinc-500 hover:text-white font-mono text-xs uppercase border border-zinc-700 px-3 py-2 hover:border-zinc-500 transition-colors">Edit Animations</button>
            </div>

            {compiledSpriteSheet ? (
              <div className="flex flex-col gap-8">
                <GameViewport
                  spriteSheetData={compiledSpriteSheet}
                  framesPerRow={4}
                  totalRows={animations.length}
                />

                {/* Sprite Sheet Preview */}
                <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[4px_4px_0_#E0E0E0] mb-8">
                  <h3 className="font-black uppercase tracking-widest text-white text-lg mb-4">Compiled Sprite Sheet</h3>
                  <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4 overflow-auto max-h-96">
                    <img src={compiledSpriteSheet} alt="Sprite Sheet" className="max-w-full" style={{ imageRendering: 'pixelated' }} />
                  </div>
                </div>

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
                No sprite sheet compiled yet.<br />Generate at least one animation row in Step 2.
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

      {selectedFrame && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in" onClick={() => !isGenerating && setSelectedFrame(null)}>
          <div className="bg-[#161616] border-4 border-zinc-800 p-6 max-w-xl w-full flex flex-col gap-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-black uppercase tracking-widest text-xl text-[#BDFF00]">
                {animations[selectedFrame.rowIndex].name} - Frame {selectedFrame.frameIndex + 1}
              </h3>
              <button onClick={() => setSelectedFrame(null)} disabled={isGenerating} className="text-zinc-500 hover:text-white"><XCircle /></button>
            </div>
            <div className="w-full aspect-square bg-[#0D0D0D] border-2 border-zinc-800 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')] flex items-center justify-center">
              <img src={selectedFrame.url} alt="Frame Zoom" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
            </div>
            <div className="flex gap-4 justify-end">
              <button
                onClick={() => handleRegenerateSingleFrame(selectedFrame.rowIndex, selectedFrame.frameIndex)}
                disabled={isGenerating}
                className="bg-[#E0E0E0] text-black font-black uppercase tracking-widest px-6 py-3 border-2 border-transparent hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? 'Regenerating...' : 'Regenerate This Frame'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Character Preview Popup */}
      {previewChar && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setPreviewChar(null)}>
          <div className="bg-[#161616] border-4 border-zinc-800 p-6 max-w-lg w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-black uppercase tracking-widest text-lg text-[#BDFF00] truncate">{previewChar.name}</h3>
              <button onClick={() => setPreviewChar(null)} className="text-zinc-500 hover:text-white"><XCircle /></button>
            </div>
            <div className="w-full aspect-square bg-[#0D0D0D] border-2 border-zinc-800 flex items-center justify-center bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')]">
              <img src={previewChar.cleanImage} alt={previewChar.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-mono text-zinc-500">
              <span className="bg-[#0D0D0D] border border-zinc-800 px-2 py-1">{ART_STYLES.find(s => s.id === previewChar.artStyle)?.label}</span>
              <span className="bg-[#0D0D0D] border border-zinc-800 px-2 py-1">{PERSPECTIVES.find(p => p.id === previewChar.perspective)?.label}</span>
              <span className="bg-[#0D0D0D] border border-zinc-800 px-2 py-1">{previewChar.group}</span>
            </div>
            {previewChar.prompt && <p className="font-mono text-xs text-zinc-500 italic">"{previewChar.prompt}"</p>}
            <div className="flex gap-2">
              <button onClick={async () => {
                  if (!previewChar.prompt || isGenerating) return;
                  setIsGenerating(true); setLoadingMsg(`Regenerating ${previewChar.name}...`);
                  try {
                    const b64 = await generateCharacter(previewChar.prompt, previewChar.artStyle, previewChar.perspective);
                    const noBg = await removeBackground(b64, 70);
                    const normalized = await normalizeCharacterSize(noBg);
                    setSavedChars(prev => prev.map(c => c.id === previewChar.id ? { ...c, rawImage: b64, cleanImage: normalized, animRows: Array(c.animations.length).fill(null), animRowsNoBg: Array(c.animations.length).fill(null), spriteSheet: null } : c));
                    setPreviewChar(prev => prev ? { ...prev, rawImage: b64, cleanImage: normalized } : null);
                  } catch (e) { handleError(e); }
                  finally { setIsGenerating(false); }
                }} disabled={isGenerating || !previewChar.prompt}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 text-white border-2 border-zinc-700 hover:bg-zinc-700 py-3 font-black uppercase tracking-widest text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <RefreshCw size={14} /> {isGenerating ? 'Generating...' : 'Regenerate'}
              </button>
              <button onClick={() => { const a = document.createElement('a'); a.href = previewChar.cleanImage; a.download = `${previewChar.name}.png`; a.click(); }}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 text-white border-2 border-zinc-700 hover:bg-zinc-700 py-3 font-black uppercase tracking-widest text-xs transition-colors">
                <Download size={14} /> Save Image
              </button>
              <button onClick={() => { handleSelectChar(previewChar.id); setPreviewChar(null); }}
                className="flex-1 flex items-center justify-center gap-2 bg-[#BDFF00] text-black border-2 border-transparent hover:border-white py-3 font-black uppercase tracking-widest text-xs transition-colors">
                <ChevronRight size={14} /> Use This Hero
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

