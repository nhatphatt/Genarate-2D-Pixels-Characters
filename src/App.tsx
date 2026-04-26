import { useState, type ChangeEvent } from 'react';
import { generateCharacter, generateAnimationRow, AnimationRowResult, regenerateSingleFrame, combineFramesIntoStrip, ArtStyle, ART_STYLES, Perspective, PERSPECTIVES, generateCharacterBatch } from './services/ai';
import { removeBackground, normalizeCharacterSize } from './lib/imageUtils';
import { compileSpriteSheet } from './lib/spriteCompiler';
import { GameViewport } from './components/GameViewport';
import {
  AlertCircle, Image as ImageIcon, Play, RefreshCw, XCircle, Download, Plus, Trash2,
  FileJson, Monitor, Gamepad2, Info, ChevronRight, Minus,
} from 'lucide-react';
import { Header, type AppState } from './components/Header';
import { EmptyLanding } from './components/EmptyLanding';
import { NewHeroDrawer } from './components/NewHeroDrawer';
import { HeroGallery, type SavedCharacter } from './components/HeroGallery';

const DEFAULT_ANIMATIONS = [
  { name: 'Idle' },
  { name: 'Walk' },
  { name: 'Run' },
  { name: 'Attack' },
  { name: 'Jump' },
  { name: 'Hurt' },
  { name: 'Death' },
];

const makeDefaultAnims = () =>
  DEFAULT_ANIMATIONS.map((anim, i) => ({ id: `default-${i}`, name: anim.name, customPrompt: '' }));

const TRANSPARENT_BG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=';

export default function App() {
  const [appState, setAppState] = useState<AppState>('CREATE_CHAR');

  // --- Character gallery ---
  const [savedChars, setSavedChars] = useState<SavedCharacter[]>([]);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);

  // --- Creation form (lifted state, persists across drawer open/close) ---
  const [charPrompt, setCharPrompt] = useState('');
  const [artStyle, setArtStyle] = useState<ArtStyle>('pixel');
  const [perspective, setPerspective] = useState<Perspective>('platformer');
  const [batchMode, setBatchMode] = useState(false);
  const [batchContext, setBatchContext] = useState('');
  const [batchNames, setBatchNames] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Derived active character
  const activeChar = savedChars.find(c => c.id === activeCharId) || null;

  const updateActiveChar = (patch: Partial<SavedCharacter>) => {
    setSavedChars(prev => prev.map(c => (c.id === activeCharId ? { ...c, ...patch } : c)));
  };

  const animations = activeChar?.animations ?? makeDefaultAnims();
  const animRows = activeChar?.animRows ?? [];
  const animRowsNoBg = activeChar?.animRowsNoBg ?? [];
  const compiledSpriteSheet = activeChar?.spriteSheet ?? null;
  // Per-animation frame counts (default 4 each, clamped 1..10).
  // Older saved characters may not have this array — fall back to 4 per animation.
  const frameCounts: number[] = (activeChar?.frameCounts && activeChar.frameCounts.length === animations.length)
    ? activeChar.frameCounts
    : animations.map(() => 4);
  const maxFramesPerRow = Math.max(1, ...frameCounts);

  const [selectedFrame, setSelectedFrame] = useState<{ rowIndex: number; frameIndex: number; url: string } | null>(null);
  const [previewChar, setPreviewChar] = useState<SavedCharacter | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleError = (error: any) => {
    console.error(error);
    const msg = error?.message || String(error);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
      setErrorMsg('Quota / Rate Limit Exceeded. You have used your free tier limit. Please wait until it resets or supply your own API Key via Settings.');
    } else {
      setErrorMsg(msg);
    }
  };

  const toggleGroup = (g: string) =>
    setCollapsedGroups(prev => {
      const s = new Set(prev);
      s.has(g) ? s.delete(g) : s.add(g);
      return s;
    });

  const moveCharToGroup = (charId: string, group: string) => {
    setSavedChars(prev => prev.map(c => (c.id === charId ? { ...c, group } : c)));
  };

  /**
   * Compute the set of "stable" row indices for an animation list — rows whose
   * frames should NOT be horizontally re-centered per-frame because they are a
   * tight breathing/looping cycle (e.g. Idle). Without this the sprite compiler
   * centers each frame on its own bbox, which makes Idle appear to "flicker"
   * left-right when arms / chest expand.
   */
  const getStableRows = (anims: { name: string }[]): Set<number> => {
    const set = new Set<number>();
    anims.forEach((a, i) => { if (a.name.trim().toLowerCase() === 'idle') set.add(i); });
    return set;
  };

  /**
   * Build the per-row, per-frame URL list that `compileSpriteSheet` consumes.
   * Each row contributes its `framesUrls` array (one PNG data-URL per frame,
   * background already removed), or `null` if not yet generated. This avoids
   * the old strip-slicing path that silently dropped frames whenever the
   * AI-rendered poses touched or the row's frame count changed.
   */
  const buildFramesPayload = (rows: (AnimationRowResult | null)[]): (string[] | null)[] =>
    rows.map(r => (r ? r.framesUrls : null));

  const createGroup = (name: string) => {
    setEmptyGroups(prev => (prev.includes(name) ? prev : [...prev, name]));
  };

  const renameGroup = (oldName: string, newName: string) => {
    setSavedChars(prev => prev.map(c => (c.group === oldName ? { ...c, group: newName } : c)));
    setEmptyGroups(prev => prev.map(g => (g === oldName ? newName : g)));
  };

  const deleteGroup = (group: string) => {
    setSavedChars(prev => prev.map(c => (c.group === group ? { ...c, group: 'Ungrouped' } : c)));
    setEmptyGroups(prev => prev.filter(g => g !== group));
  };

  const renameChar = (charId: string, name: string) => {
    setSavedChars(prev => prev.map(c => (c.id === charId ? { ...c, name } : c)));
  };

  const addCharToGallery = (raw: string, clean: string, prompt: string, group = 'Ungrouped', charName?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    const name = charName || prompt.slice(0, 30) || 'Uploaded Hero';
    const char: SavedCharacter = {
      id, name, prompt, group, artStyle, perspective, rawImage: raw, cleanImage: clean,
      animations: makeDefaultAnims(),
      frameCounts: DEFAULT_ANIMATIONS.map(() => 4),
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
    setLoadingMsg('Generating base character...');
    try {
      const b64 = await generateCharacter(charPrompt, artStyle, perspective);
      setLoadingMsg('Removing green background...');
      const noBg = await removeBackground(b64, 70);
      setLoadingMsg('Normalizing size...');
      const normalized = await normalizeCharacterSize(noBg);
      addCharToGallery(b64, normalized, charPrompt);
      setDrawerOpen(false);
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
    setEmptyGroups(prev => (prev.includes(groupName) ? prev : [...prev, groupName]));
    try {
      const results = await generateCharacterBatch(names, batchContext, artStyle, perspective, msg => setLoadingMsg(msg));
      for (const r of results) {
        setLoadingMsg(`Cleaning ${r.name}...`);
        const noBg = await removeBackground(r.dataUrl, 70);
        const normalized = await normalizeCharacterSize(noBg);
        addCharToGallery(r.dataUrl, normalized, r.name, groupName, r.name);
      }
      setBatchNames('');
      setBatchContext('');
      setDrawerOpen(false);
    } catch (e) {
      handleError(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please upload a valid image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async event => {
      if (!event.target?.result) return;
      const raw = event.target.result as string;
      setIsGenerating(true);
      setLoadingMsg('Removing green background...');
      try {
        const noBg = await removeBackground(raw, 70);
        const normalized = await normalizeCharacterSize(noBg);
        addCharToGallery(raw, normalized, 'Uploaded Hero');
        setDrawerOpen(false);
      } catch {
        addCharToGallery(raw, raw, 'Uploaded Hero');
        setDrawerOpen(false);
      } finally {
        setIsGenerating(false);
      }
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
    const charFrameCounts = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);
    const fc = charFrameCounts[rowIndex] ?? 4;
    setLoadingMsg(`Generating ${animDef.name} animation (${fc} frames)...`);
    try {
      const sourceImage = activeChar.cleanImage;
      const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, msg => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective, fc);

      const newRows = [...activeChar.animRows];
      newRows[rowIndex] = b64;
      const newRowsNoBg = [...activeChar.animRowsNoBg];
      newRowsNoBg[rowIndex] = b64.rowUrl;

      setLoadingMsg('Compiling Sprite Sheet...');
      const compiled = await compileSpriteSheet(buildFramesPayload(newRows), charFrameCounts, activeChar.cleanImage || undefined, getStableRows(activeChar.animations));
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
    const charFrameCounts = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);
    const fc = charFrameCounts[rowIndex] ?? 4;
    setLoadingMsg(`Regenerating ${animDef.name} frame ${frameIndex + 1}/${fc}...`);
    try {
      const sourceImage = activeChar.cleanImage;
      const newFrameUrl = await regenerateSingleFrame(sourceImage, animDef.name, animDef.customPrompt, frameIndex, msg => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective, fc);

      const newRows = [...activeChar.animRows];
      const row = newRows[rowIndex]!;
      const newFramesUrls = [...row.framesUrls];
      newFramesUrls[frameIndex] = newFrameUrl;

      setLoadingMsg('Recombining frames...');
      const newRowUrl = await combineFramesIntoStrip(newFramesUrls);
      newRows[rowIndex] = { rowUrl: newRowUrl, framesUrls: newFramesUrls };

      const newRowsNoBg = [...activeChar.animRowsNoBg];
      newRowsNoBg[rowIndex] = newRowUrl;

      setSelectedFrame(prev => (prev ? { ...prev, url: newFrameUrl } : null));

      setLoadingMsg('Compiling Sprite Sheet...');
      const compiled = await compileSpriteSheet(buildFramesPayload(newRows), charFrameCounts, activeChar.cleanImage || undefined, getStableRows(activeChar.animations));
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
    const charFrameCounts = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);

    try {
      const sourceImage = activeChar.cleanImage;
      for (let i = 0; i < activeChar.animations.length; i++) {
        if (!currentRows[i]) {
          const animDef = activeChar.animations[i];
          const fc = charFrameCounts[i] ?? 4;
          setLoadingMsg(`Generating ${animDef.name} (${i + 1}/${activeChar.animations.length}) — ${fc} frames...`);

          const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, msg => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective, fc);
          currentRows[i] = b64;
          currentRowsNoBg[i] = b64.rowUrl;
          updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg] });

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setLoadingMsg('Compiling final Sprite Sheet...');
      const compiled = await compileSpriteSheet(buildFramesPayload(currentRows), charFrameCounts, activeChar.cleanImage || undefined, getStableRows(activeChar.animations));
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
    const charFrameCounts = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);

    try {
      const sourceImage = activeChar.cleanImage;
      for (let i = 0; i < activeChar.animations.length; i++) {
        const animDef = activeChar.animations[i];
        const fc = charFrameCounts[i] ?? 4;
        setLoadingMsg(`Re-generating ${animDef.name} (${i + 1}/${activeChar.animations.length}) — ${fc} frames...`);

        const b64 = await generateAnimationRow(sourceImage, animDef.name, animDef.customPrompt, msg => setLoadingMsg(msg), activeChar.artStyle, activeChar.perspective, fc);
        currentRows[i] = b64;
        currentRowsNoBg[i] = b64.rowUrl;
        updateActiveChar({ animRows: [...currentRows], animRowsNoBg: [...currentRowsNoBg] });

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setLoadingMsg('Compiling final Sprite Sheet...');
      const compiled = await compileSpriteSheet(buildFramesPayload(currentRows), charFrameCounts, activeChar.cleanImage || undefined, getStableRows(activeChar.animations));
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
    const existingFC = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);
    updateActiveChar({
      animations: [...activeChar.animations, { id: Math.random().toString(), name: 'Custom Action', customPrompt: '' }],
      frameCounts: [...existingFC, 4],
      animRows: [...activeChar.animRows, null],
      animRowsNoBg: [...activeChar.animRowsNoBg, null],
    });
  };

  const handleRemoveAnimation = (index: number) => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations]; newAnims.splice(index, 1);
    const newRows = [...activeChar.animRows]; newRows.splice(index, 1);
    const newRowsNoBg = [...activeChar.animRowsNoBg]; newRowsNoBg.splice(index, 1);
    const existingFC = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? [...activeChar.frameCounts]
      : activeChar.animations.map(() => 4);
    existingFC.splice(index, 1);
    updateActiveChar({ animations: newAnims, frameCounts: existingFC, animRows: newRows, animRowsNoBg: newRowsNoBg });
  };

  /**
   * Update the frame count for a single animation row.
   * Clamps to 1..10. Resets that row's generated frames so the user must re-generate
   * to match the new count (a 6-frame strip cannot be re-sliced from a 4-frame one).
   */
  const handleUpdateFrameCount = (rowIndex: number, delta: number) => {
    if (!activeChar) return;
    const existingFC = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? [...activeChar.frameCounts]
      : activeChar.animations.map(() => 4);
    const current = existingFC[rowIndex] ?? 4;
    const next = Math.max(1, Math.min(10, current + delta));
    if (next === current) return;
    existingFC[rowIndex] = next;

    // Invalidate this row's existing strip since frame count changed.
    const newRows = [...activeChar.animRows];
    const newRowsNoBg = [...activeChar.animRowsNoBg];
    const hadStrip = !!newRows[rowIndex];
    if (hadStrip) {
      newRows[rowIndex] = null;
      newRowsNoBg[rowIndex] = null;
    }

    updateActiveChar({
      frameCounts: existingFC,
      animRows: newRows,
      animRowsNoBg: newRowsNoBg,
      // Sprite sheet must be recompiled after re-generating; clear it for now.
      spriteSheet: hadStrip ? null : activeChar.spriteSheet,
    });
  };

  const getSpriteMetadata = () => {
    if (!compiledSpriteSheet) return null;
    const img = new Image();
    img.src = compiledSpriteSheet;
    const cols = maxFramesPerRow;
    const frameW = Math.floor(img.width / cols);
    const frameH = Math.floor(img.height / animations.length);
    return { sheetW: img.width, sheetH: img.height, frameW, frameH, rows: animations.length, cols };
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

    const frames: Record<string, any> = {};
    const animationTags: { name: string; from: number; to: number; direction: string }[] = [];
    let globalIdx = 0;

    animations.forEach((anim, rowIdx) => {
      const rowFrames = frameCounts[rowIdx] ?? 4;
      const tagFrom = globalIdx;
      // Only emit entries for the actual frames in this row — unused cells
      // (when row has fewer frames than the sheet's max columns) are skipped.
      for (let col = 0; col < rowFrames; col++) {
        const key = `${anim.name.toLowerCase()}_${col}`;
        frames[key] = {
          frame: { x: col * meta.frameW, y: rowIdx * meta.frameH, w: meta.frameW, h: meta.frameH },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: meta.frameW, h: meta.frameH },
          sourceSize: { w: meta.frameW, h: meta.frameH },
        };
        globalIdx++;
      }
      animationTags.push({ name: anim.name, from: tagFrom, to: globalIdx - 1, direction: 'forward' });
    });

    const atlas = {
      frames,
      animations: animations.reduce((acc, anim, rowIdx) => {
        const rowFrames = frameCounts[rowIdx] ?? 4;
        acc[anim.name.toLowerCase()] = Array.from({ length: rowFrames }, (_, i) => `${anim.name.toLowerCase()}_${i}`);
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
        grid: { cellWidth: meta.frameW, cellHeight: meta.frameH, columns: meta.cols, rows: meta.rows },
      },
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
      <Header
        appState={appState}
        setAppState={setAppState}
        activeChar={activeChar ? { id: activeChar.id, name: activeChar.name, cleanImage: activeChar.cleanImage } : null}
        charCount={savedChars.length}
        animationsDone={animRows.filter(Boolean).length}
        animationsTotal={animations.length}
        hasSpriteSheet={!!compiledSpriteSheet}
        onNewHero={() => setDrawerOpen(true)}
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {errorMsg && (
          <div className="bg-red-900/40 border-2 border-red-500 text-red-100 p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="shrink-0 mt-0.5" size={18} />
            <div className="flex-1 min-w-0">
              <p className="font-black uppercase tracking-widest mb-1 text-xs">Error</p>
              <p className="font-mono text-xs break-words">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-auto hover:text-white shrink-0"><XCircle size={18} /></button>
          </div>
        )}

        {/* STEP 1: Characters */}
        {appState === 'CREATE_CHAR' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {savedChars.length === 0 ? (
              <EmptyLanding onStart={() => setDrawerOpen(true)} />
            ) : (
              <HeroGallery
                savedChars={savedChars}
                emptyGroups={emptyGroups}
                activeCharId={activeCharId}
                collapsedGroups={collapsedGroups}
                onSelectChar={handleSelectChar}
                onPreviewChar={setPreviewChar}
                onDeleteChar={handleDeleteChar}
                onMoveCharToGroup={moveCharToGroup}
                onCreateGroup={createGroup}
                onDeleteGroup={deleteGroup}
                onRenameGroup={renameGroup}
                onRenameChar={renameChar}
                onToggleGroup={toggleGroup}
              />
            )}
          </div>
        )}

        {/* STEP 2: Animations */}
        {appState === 'CREATE_ANIM' && activeChar && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#161616] border-2 border-zinc-800 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-3">
                <img src={activeChar.cleanImage} alt="" className="w-12 h-12 object-contain bg-[#0D0D0D] border border-zinc-800 p-1" style={{ imageRendering: 'pixelated' }} />
                <div>
                  <h2 className="font-black uppercase tracking-widest text-xl">{activeChar.name}</h2>
                  <p className="font-mono text-[10px] text-zinc-500">
                    {ART_STYLES.find(s => s.id === activeChar.artStyle)?.label} / {PERSPECTIVES.find(p => p.id === activeChar.perspective)?.label} -- <span className="text-[#BDFF00]">{animRows.filter(Boolean).length}/{animations.length} animations</span>
                  </p>
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
                    <div className="w-full md:w-32 shrink-0 flex flex-col gap-2">
                      <input
                        type="text"
                        value={animDef.name}
                        onChange={e => handleUpdateAnimation(i, 'name', e.target.value)}
                        className="w-full bg-[#0D0D0D] border-x-0 border-t-0 border-b-2 border-zinc-800 p-1 text-white font-black uppercase tracking-widest text-lg focus:outline-none focus:border-[#BDFF00]"
                      />
                      {/* Frame-count stepper (1..10). Changing this clears the row's existing strip. */}
                      <div className="flex items-center gap-1 bg-[#0D0D0D] border border-zinc-800 px-1.5 py-1">
                        <button
                          onClick={() => handleUpdateFrameCount(i, -1)}
                          disabled={isGenerating || (frameCounts[i] ?? 4) <= 1}
                          title="Decrease frames"
                          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-[#BDFF00] hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <div className="flex-1 text-center font-mono text-[10px] uppercase text-zinc-500 leading-tight">
                          <div className="text-[#BDFF00] text-sm font-black">{frameCounts[i] ?? 4}</div>
                          <div>frames</div>
                        </div>
                        <button
                          onClick={() => handleUpdateFrameCount(i, +1)}
                          disabled={isGenerating || (frameCounts[i] ?? 4) >= 10}
                          title="Increase frames"
                          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-[#BDFF00] hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>

                    <div
                      className="flex-1 w-full bg-[#0D0D0D] border-2 border-zinc-900 border-dashed h-24 relative overflow-hidden flex items-center justify-center"
                      style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
                    >
                      {animRows[i] ? (
                        <div className="flex gap-2 sm:gap-4 h-full py-2">
                          {animRows[i]!.framesUrls.map((fUrl: string, fIdx: number) => (
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
                      onChange={e => handleUpdateAnimation(i, 'customPrompt', e.target.value)}
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

        {/* STEP 3: Play / Export */}
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
                  framesPerRow={maxFramesPerRow}
                  framesPerRowList={frameCounts}
                  totalRows={animations.length}
                />

                <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[4px_4px_0_#E0E0E0] mb-8">
                  <h3 className="font-black uppercase tracking-widest text-white text-lg mb-4">Compiled Sprite Sheet</h3>
                  <div className="bg-[#0D0D0D] border-2 border-zinc-800 p-4 overflow-auto max-h-96">
                    <img src={compiledSpriteSheet} alt="Sprite Sheet" className="max-w-full" style={{ imageRendering: 'pixelated' }} />
                  </div>
                </div>

                <div className="bg-[#161616] border-4 border-zinc-800 p-6 shadow-[4px_4px_0_#BDFF00]">
                  <h3 className="font-black uppercase tracking-widest text-[#BDFF00] text-xl mb-6 flex items-center gap-2">
                    <Download size={20} /> Export for Game Engines
                  </h3>

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

      {/* New Hero Drawer */}
      <NewHeroDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isGenerating={isGenerating}
        loadingMsg={loadingMsg}
        charPrompt={charPrompt}
        setCharPrompt={setCharPrompt}
        artStyle={artStyle}
        setArtStyle={setArtStyle}
        perspective={perspective}
        setPerspective={setPerspective}
        batchMode={batchMode}
        setBatchMode={setBatchMode}
        batchContext={batchContext}
        setBatchContext={setBatchContext}
        batchNames={batchNames}
        setBatchNames={setBatchNames}
        onGenerate={handleGenerateChar}
        onBatchGenerate={handleBatchGenerate}
        onUpload={handleImageUpload}
      />

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
            <div
              className="w-full aspect-square bg-[#0D0D0D] border-2 border-zinc-800 flex items-center justify-center"
              style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
            >
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
            <div
              className="w-full aspect-square bg-[#0D0D0D] border-2 border-zinc-800 flex items-center justify-center"
              style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
            >
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
