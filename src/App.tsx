import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { generateCharacter, generateAnimationRow, AnimationRowResult, regenerateSingleFrame, combineFramesIntoStrip, ArtStyle, ART_STYLES, Perspective, PERSPECTIVES, generateCharacterBatch } from './services/ai';
import { removeBackground, normalizeCharacterSize } from './lib/imageUtils';
import { compileSpriteSheet } from './lib/spriteCompiler';
import { GameViewport } from './components/GameViewport';
import {
  AlertCircle, Image as ImageIcon, Play, RefreshCw, XCircle, Download, Plus, Trash2,
  FileJson, Monitor, Gamepad2, Info, ChevronRight, Minus, Repeat, ArrowRight, ArrowLeftRight,
} from 'lucide-react';
import { Header, type AppState } from './components/Header';
import { EmptyLanding } from './components/EmptyLanding';
import { NewHeroDrawer } from './components/NewHeroDrawer';
import { HeroGallery, type SavedCharacter } from './components/HeroGallery';
import { ProjectMenu } from './components/ProjectMenu';
import { HotkeyChip } from './components/HotkeyChip';
import { loadState, saveState, defaultPlaybackFor, isLocomotionName } from './lib/storage';
import { buildAtlas, type AtlasFormat } from './lib/atlas';

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
  DEFAULT_ANIMATIONS.map((anim, i) => {
    const def = defaultPlaybackFor(anim.name);
    return { id: `default-${i}`, name: anim.name, customPrompt: '', fps: def.fps, loop: def.loop, keyBind: def.keyBind };
  });

const TRANSPARENT_BG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=';

export default function App() {
  const [appState, setAppState] = useState<AppState>('CREATE_CHAR');

  // --- Character gallery ---
  const [savedChars, setSavedChars] = useState<SavedCharacter[]>([]);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

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

  // Atlas export format. RFC-002 §G3.
  const [atlasFormat, setAtlasFormat] = useState<AtlasFormat>('aseprite-hash');

  // ============================================================
  // Persistence — RFC-002 §G1.
  // Hydrate once from IndexedDB, then debounced-write on every change.
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadState();
      if (cancelled) return;
      setSavedChars(loaded.savedChars);
      setEmptyGroups(loaded.emptyGroups);
      setActiveCharId(loaded.activeCharId);
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const writeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return; // never overwrite real data with the empty initial state
    if (writeTimer.current !== null) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      void saveState(
        { savedChars, emptyGroups, activeCharId },
        (e) => {
          const msg = (e as Error)?.message ?? String(e);
          if (msg.toLowerCase().includes('quota')) {
            setErrorMsg('Storage quota exceeded — your project is too big to save in this browser. Export to a .json file from the Project menu to keep a copy.');
          }
        },
      );
    }, 500);
    return () => {
      if (writeTimer.current !== null) {
        window.clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
    };
  }, [savedChars, emptyGroups, activeCharId, hydrated]);

  // ============================================================
  // Scroll-to-top on step change.
  // The page is a long single column (gallery + animation cards + step-3
  // viewport). When the user clicks "Continue to test & export" or the
  // step pills in the header, the browser keeps the previous scroll
  // position, which lands them halfway down the new step. Reset to top
  // whenever appState changes — instant, not smooth, so it doesn't read
  // as a janky animation while images/canvases are still mounting.
  // ============================================================
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [appState]);

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
    const prev = newAnims[index];
    if (field === 'name') {
      // When the name changes, refresh fps/loop to the preset for that name
      // ONLY if the user hasn't already manually customised them (i.e. they
      // still match the previous name's preset). Otherwise keep their values.
      const prevDef = defaultPlaybackFor(prev.name);
      const nextDef = defaultPlaybackFor(value);
      const isPristineFps  = prev.fps  === prevDef.fps;
      const isPristineLoop = prev.loop === prevDef.loop;
      newAnims[index] = {
        ...prev,
        name: value,
        fps:  isPristineFps  ? nextDef.fps  : prev.fps,
        loop: isPristineLoop ? nextDef.loop : prev.loop,
      };
    } else {
      newAnims[index] = { ...prev, customPrompt: value };
    }
    updateActiveChar({ animations: newAnims });
  };

  const handleUpdateAnimFps = (index: number, fps: number) => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations];
    newAnims[index] = { ...newAnims[index], fps: Math.max(1, Math.min(30, Math.round(fps))) };
    updateActiveChar({ animations: newAnims });
  };

  const handleUpdateAnimLoop = (index: number, loop: 'forward' | 'pingpong' | 'once') => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations];
    newAnims[index] = { ...newAnims[index], loop };
    updateActiveChar({ animations: newAnims });
  };

  const handleUpdateAnimKeyBind = (index: number, keyBind: string) => {
    if (!activeChar) return;
    const newAnims = [...activeChar.animations];
    newAnims[index] = { ...newAnims[index], keyBind };
    updateActiveChar({ animations: newAnims });
  };

  const handleAddAnimation = () => {
    if (!activeChar) return;
    const existingFC = (activeChar.frameCounts && activeChar.frameCounts.length === activeChar.animations.length)
      ? activeChar.frameCounts
      : activeChar.animations.map(() => 4);
    const def = defaultPlaybackFor('Custom Action');
    // Pick the first free Digit1..Digit9 so the new custom row has a usable
    // hotkey out of the box. Falls back to "" if all 9 are taken.
    const taken = new Set(activeChar.animations.map(a => a.keyBind).filter(Boolean));
    let freshBind = '';
    for (let n = 1; n <= 9; n++) {
      const c = `Digit${n}`;
      if (!taken.has(c)) { freshBind = c; break; }
    }
    updateActiveChar({
      animations: [...activeChar.animations, { id: Math.random().toString(), name: 'Custom Action', customPrompt: '', fps: def.fps, loop: def.loop, keyBind: freshBind }],
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

    // RFC-002 §G3 — emit either Aseprite-hash or TexturePacker-array.
    const atlas = buildAtlas(
      {
        imageFilename: 'spritesheet.png',
        spriteName: activeChar?.name ?? 'sprite',
        geometry: {
          frameW: meta.frameW,
          frameH: meta.frameH,
          cols:   meta.cols,
          rows:   meta.rows,
          sheetW: meta.sheetW,
          sheetH: meta.sheetH,
        },
        animations: animations.map((a, i) => ({
          name:       a.name,
          frameCount: frameCounts[i] ?? 4,
          fps:        a.fps,
          loop:       a.loop,
        })),
      },
      atlasFormat,
    );

    const filename = atlasFormat === 'aseprite-hash'
      ? 'spritesheet.aseprite.json'
      : 'spritesheet.texturepacker.json';

    const blob = new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#171717] text-[#fafafa]">
      <Header
        appState={appState}
        setAppState={setAppState}
        activeChar={activeChar ? { id: activeChar.id, name: activeChar.name, cleanImage: activeChar.cleanImage } : null}
        charCount={savedChars.length}
        animationsDone={animRows.filter(Boolean).length}
        animationsTotal={animations.length}
        hasSpriteSheet={!!compiledSpriteSheet}
        onNewHero={() => setDrawerOpen(true)}
        projectMenu={
          <ProjectMenu
            characters={savedChars}
            emptyGroups={emptyGroups}
            onImport={(next) => {
              setSavedChars(next.characters);
              setEmptyGroups(next.emptyGroups);
              // Keep activeCharId only if it survived the import.
              if (activeCharId && !next.characters.find(c => c.id === activeCharId)) {
                setActiveCharId(null);
                setAppState('CREATE_CHAR');
              }
            }}
            onError={(msg) => setErrorMsg(msg)}
          />
        }
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        {errorMsg && (
          <div
            className="rounded-lg border p-4 mb-6 flex items-start gap-3"
            style={{ background: 'hsla(348, 75%, 30%, 0.18)', borderColor: 'hsla(348, 75%, 55%, 0.35)', color: 'hsl(348, 95%, 90%)' }}
          >
            <AlertCircle className="shrink-0 mt-0.5" size={18} />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[1.2px] mb-1">Error</p>
              <p className="font-mono text-[12px] break-words">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-auto opacity-70 hover:opacity-100 shrink-0"><XCircle size={18} /></button>
          </div>
        )}

        {/* STEP 1: Characters */}
        {appState === 'CREATE_CHAR' && (
          <div className="animate-slide-up">
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
          <div className="space-y-5 animate-slide-up">
            <div className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-5 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-md bg-[#0f0f0f] border border-[#2e2e2e] p-1 flex items-center justify-center">
                  <img src={activeChar.cleanImage} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                </div>
                <div>
                  <h2 className="text-card-title text-[#fafafa]">{activeChar.name}</h2>
                  <p className="text-[12px] text-[#898989]">
                    {ART_STYLES.find(s => s.id === activeChar.artStyle)?.label} · {PERSPECTIVES.find(p => p.id === activeChar.perspective)?.label} · <span className="text-[#3ecf8e]">{animRows.filter(Boolean).length}/{animations.length} animations</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => setAppState('CREATE_CHAR')} className="btn-ghost">Switch hero</button>
                <button onClick={handleGenerateAllMissing} disabled={isGenerating} className="btn-secondary !px-4">
                  Auto-gen missing
                </button>
                <button onClick={handleRegenerateAll} disabled={isGenerating} className="btn-brand !px-4">
                  Re-gen all
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {animations.map((animDef, i) => (
                <div key={animDef.id} className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-5 flex flex-col gap-4 hover:border-[#363636] transition-colors">
                  <div className="flex flex-col md:flex-row items-center gap-4">
                    <div className="w-full md:w-44 shrink-0 flex flex-col gap-2">
                      <input
                        type="text"
                        value={animDef.name}
                        onChange={e => handleUpdateAnimation(i, 'name', e.target.value)}
                        className="w-full bg-transparent border-0 border-b border-[#2e2e2e] p-1 text-[#fafafa] text-[18px] font-medium tracking-tight focus:outline-none focus:border-[#3ecf8e]"
                      />
                      {/* Frame-count stepper (1..10). Changing this clears the row's existing strip. */}
                      <div className="flex items-center gap-1 rounded-md bg-[#0f0f0f] border border-[#2e2e2e] px-1.5 py-1">
                        <button
                          onClick={() => handleUpdateFrameCount(i, -1)}
                          disabled={isGenerating || (frameCounts[i] ?? 4) <= 1}
                          title="Decrease frames"
                          className="w-6 h-6 rounded-sm flex items-center justify-center text-[#898989] hover:text-[#3ecf8e] hover:bg-[#1c1c1c] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <div className="flex-1 text-center leading-tight">
                          <div className="text-[#3ecf8e] text-[14px] font-medium">{frameCounts[i] ?? 4}</div>
                          <div className="label-mono text-[9px] tracking-[1.2px]">frames</div>
                        </div>
                        <button
                          onClick={() => handleUpdateFrameCount(i, +1)}
                          disabled={isGenerating || (frameCounts[i] ?? 4) >= 10}
                          title="Increase frames"
                          className="w-6 h-6 rounded-sm flex items-center justify-center text-[#898989] hover:text-[#3ecf8e] hover:bg-[#1c1c1c] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* FPS stepper. RFC-002 §G4. */}
                      <div className="flex items-center gap-1 rounded-md bg-[#0f0f0f] border border-[#2e2e2e] px-1.5 py-1" title="Playback speed in frames per second. Drives the in-app viewport and the exported per-frame duration.">
                        <button
                          onClick={() => handleUpdateAnimFps(i, (animDef.fps ?? 8) - 1)}
                          disabled={isGenerating || (animDef.fps ?? 8) <= 1}
                          className="w-6 h-6 rounded-sm flex items-center justify-center text-[#898989] hover:text-[#3ecf8e] hover:bg-[#1c1c1c] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <div className="flex-1 text-center leading-tight">
                          <div className="text-[#3ecf8e] text-[14px] font-medium">{animDef.fps ?? 8}</div>
                          <div className="label-mono text-[9px] tracking-[1.2px]">fps</div>
                        </div>
                        <button
                          onClick={() => handleUpdateAnimFps(i, (animDef.fps ?? 8) + 1)}
                          disabled={isGenerating || (animDef.fps ?? 8) >= 30}
                          className="w-6 h-6 rounded-sm flex items-center justify-center text-[#898989] hover:text-[#3ecf8e] hover:bg-[#1c1c1c] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* Loop type. RFC-002 §G4. Three modes:
                       *   forward  = 0→1→2→3→0… (Idle, Walk, Run)
                       *   pingpong = 0→1→2→3→2→1→0→1… (breathing, hover float)
                       *   once     = 0→1→2→3 then hold last frame (Attack, Jump, Hurt, Death)
                       */}
                      <div className="rounded-md bg-[#0f0f0f] border border-[#2e2e2e] px-1.5 py-1">
                        <div className="label-mono text-[9px] tracking-[1.2px] text-center mb-1">loop</div>
                        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Loop type">
                          {([
                            { v: 'forward',  Icon: Repeat,         label: 'Loop',     title: 'Forward loop — 0,1,2,3,0,1,2,3…'                  },
                            { v: 'pingpong', Icon: ArrowLeftRight, label: 'Ping',     title: 'Ping-pong — 0,1,2,3,2,1,0,1…'                     },
                            { v: 'once',     Icon: ArrowRight,     label: 'Once',     title: 'Play once — 0,1,2,3 then hold the last frame'   },
                          ] as const).map(({ v, Icon, label, title }) => {
                            const active = (animDef.loop ?? 'forward') === v;
                            return (
                              <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                aria-label={title}
                                title={title}
                                onClick={() => handleUpdateAnimLoop(i, v)}
                                disabled={isGenerating}
                                className={[
                                  'flex-1 h-9 rounded-sm flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                                  active ? 'bg-[#3ecf8e]/15 text-[#3ecf8e]' : 'text-[#898989] hover:text-[#fafafa] hover:bg-[#1c1c1c]',
                                ].join(' ')}
                              >
                                <Icon size={12} />
                                <span className="text-[9px] font-medium tracking-[0.4px] leading-none">{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Hotkey chip — RFC-003. Locomotion rows show a static
                       *  label and are non-interactive; everything else lets
                       *  the user click + press a key to rebind. */}
                      {(() => {
                        const lower = animDef.name.trim().toLowerCase();
                        const isLoco = isLocomotionName(animDef.name);
                        const staticLabel =
                          lower === 'walk'  ? 'Arrow keys' :
                          lower === 'run'   ? 'Arrow + Shift' :
                          lower === 'jump'  ? 'Space / W' :
                          lower === 'idle'  ? 'Auto (rest)' :
                                              undefined;
                        return (
                          <div className="flex items-center justify-center">
                            <HotkeyChip
                              value={animDef.keyBind ?? ''}
                              onChange={(next) => handleUpdateAnimKeyBind(i, next)}
                              disabled={isLoco}
                              staticLabel={staticLabel}
                            />
                          </div>
                        );
                      })()}
                    </div>

                    <div
                      className="flex-1 w-full rounded-lg bg-[#0f0f0f] border border-dashed border-[#2e2e2e] h-24 relative overflow-hidden flex items-center justify-center"
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
                        <span className="label-mono">No data</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 shrink-0 w-full md:w-36">
                      <button
                        onClick={() => handleGenerateRow(i)}
                        disabled={isGenerating}
                        className={animRows[i] ? 'btn-secondary w-full' : 'btn-brand w-full'}
                      >
                        {animRows[i] ? 'Re-roll' : 'Generate'}
                      </button>
                      {i >= DEFAULT_ANIMATIONS.length && !animRows[i] && (
                        <button
                          onClick={() => handleRemoveAnimation(i)}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-full text-[12px] font-medium px-3 py-2 border transition-colors"
                          style={{ background: 'transparent', borderColor: 'hsla(348, 75%, 55%, 0.30)', color: 'hsl(348, 80%, 75%)' }}
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="w-full">
                    <input
                      type="text"
                      placeholder="Optional: Custom AI prompt for this action (e.g. 'Throwing a fireball forward')"
                      value={animDef.customPrompt}
                      onChange={e => handleUpdateAnimation(i, 'customPrompt', e.target.value)}
                      className="input-base font-mono text-[12px]"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={handleAddAnimation}
                className="w-full rounded-xl border border-dashed border-[#2e2e2e] text-[#898989] hover:text-[#fafafa] hover:border-[#363636] p-4 text-[14px] font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Plus size={18} /> Add custom action
              </button>

              {compiledSpriteSheet && (
                <button onClick={() => setAppState('PLAY')} className="btn-brand w-full !py-3 mt-4">
                  <Play size={16} /> Continue to test & export
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Play / Export */}
        {appState === 'PLAY' && activeChar && (
          <div className="space-y-5 animate-slide-up">
            <div className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-5 flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-md bg-[#0f0f0f] border border-[#2e2e2e] p-1 flex items-center justify-center">
                  <img src={activeChar.cleanImage} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                </div>
                <div>
                  <h2 className="text-card-title text-[#fafafa]">{activeChar.name}</h2>
                  <p className="text-[12px] text-[#898989]">Test & export</p>
                </div>
              </div>
              <button onClick={() => setAppState('CREATE_ANIM')} className="btn-ghost">Edit animations</button>
            </div>

            {compiledSpriteSheet ? (
              <div className="flex flex-col gap-8">
                <GameViewport
                  spriteSheetData={compiledSpriteSheet}
                  framesPerRow={maxFramesPerRow}
                  framesPerRowList={frameCounts}
                  totalRows={animations.length}
                  animationsMeta={animations.map(a => ({ name: a.name, fps: a.fps, loop: a.loop, keyBind: a.keyBind ?? '' }))}
                />

                <div className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-6">
                  <h3 className="text-[18px] font-medium text-[#fafafa] mb-4 tracking-tight">Compiled sprite sheet</h3>
                  <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4 overflow-auto max-h-96">
                    <img src={compiledSpriteSheet} alt="Sprite Sheet" className="max-w-full" style={{ imageRendering: 'pixelated' }} />
                  </div>
                </div>

                <div className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-6">
                  <h3 className="text-[20px] font-medium text-[#fafafa] mb-6 flex items-center gap-2 tracking-tight">
                    <Download size={18} className="text-[#3ecf8e]" /> Export for game engines
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={handleDownloadPNG}
                      className="flex items-center gap-4 rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-5 hover:border-[#3ecf8e]/40 transition-colors group text-left"
                    >
                      <div className="w-12 h-12 rounded-md bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 flex items-center justify-center shrink-0">
                        <ImageIcon size={22} className="text-[#3ecf8e]" />
                      </div>
                      <div>
                        <div className="text-[14px] font-medium text-[#fafafa] tracking-tight">Sprite sheet PNG</div>
                        <div className="text-[12px] text-[#898989] mt-1">Lossless image · Transparent background</div>
                      </div>
                    </button>

                    <button
                      onClick={handleDownloadJSON}
                      className="flex items-center gap-4 rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-5 hover:border-[#3ecf8e]/40 transition-colors group text-left"
                    >
                      <div className="w-12 h-12 rounded-md bg-[#3ecf8e]/10 border border-[#3ecf8e]/30 flex items-center justify-center shrink-0">
                        <FileJson size={22} className="text-[#3ecf8e]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-[#fafafa] tracking-tight">
                          {atlasFormat === 'aseprite-hash' ? 'Aseprite JSON atlas' : 'TexturePacker JSON atlas'}
                        </div>
                        <div className="text-[12px] text-[#898989] mt-1">
                          {atlasFormat === 'aseprite-hash'
                            ? 'Phaser 3 / Godot / Unity (per-frame duration + tags)'
                            : 'Array form for some Phaser tutorials & Cocos'}
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Atlas format picker. RFC-002 §G3. */}
                  <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-3 mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="label-mono shrink-0">Atlas format</span>
                    <div className="flex items-center gap-1 rounded-md bg-[#171717] border border-[#2e2e2e] p-0.5" role="radiogroup" aria-label="Atlas format">
                      {([
                        { v: 'aseprite-hash',       label: 'Aseprite (hash)'      },
                        { v: 'texturepacker-array', label: 'TexturePacker (array)'},
                      ] as const).map(({ v, label }) => {
                        const active = atlasFormat === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setAtlasFormat(v)}
                            className={[
                              'h-7 px-3 rounded-sm text-[12px] font-medium transition-colors',
                              active ? 'bg-[#3ecf8e]/15 text-[#3ecf8e]' : 'text-[#898989] hover:text-[#fafafa] hover:bg-[#1c1c1c]',
                            ].join(' ')}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-[#898989] sm:ml-auto font-mono">
                      Per-frame duration + loop direction baked in
                    </p>
                  </div>

                  {(() => {
                    const meta = getSpriteMetadata();
                    if (!meta) return null;
                    return (
                      <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4 mb-8">
                        <h4 className="label-mono mb-3 flex items-center gap-2">
                          <Info size={13} /> Sprite sheet info
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="rounded-md bg-[#171717] border border-[#2e2e2e] p-3">
                            <div className="font-mono text-[#3ecf8e] text-[18px] font-medium">{meta.frameW} × {meta.frameH}</div>
                            <div className="label-mono text-[10px] mt-0.5">Frame size</div>
                          </div>
                          <div className="rounded-md bg-[#171717] border border-[#2e2e2e] p-3">
                            <div className="font-mono text-[#3ecf8e] text-[18px] font-medium">{meta.cols} × {meta.rows}</div>
                            <div className="label-mono text-[10px] mt-0.5">Grid (C × R)</div>
                          </div>
                          <div className="rounded-md bg-[#171717] border border-[#2e2e2e] p-3">
                            <div className="font-mono text-[#3ecf8e] text-[18px] font-medium">{meta.sheetW} × {meta.sheetH}</div>
                            <div className="label-mono text-[10px] mt-0.5">Sheet size</div>
                          </div>
                          <div className="rounded-md bg-[#171717] border border-[#2e2e2e] p-3">
                            <div className="font-mono text-[#3ecf8e] text-[18px] font-medium">{meta.cols * meta.rows}</div>
                            <div className="label-mono text-[10px] mt-0.5">Total frames</div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {animations.map((a, i) => (
                            <span key={a.id} className="rounded-full bg-[#171717] border border-[#2e2e2e] px-2.5 py-1 font-mono text-[11px] text-[#b4b4b4]">
                              <span className="text-[#3ecf8e]">Row {i}</span> · {a.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <h4 className="label-mono mb-3 flex items-center gap-2">
                    <Gamepad2 size={13} /> How to use in game engines
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor size={14} className="text-[#3ecf8e]" />
                        <span className="text-[14px] font-medium text-[#fafafa] tracking-tight">Unity</span>
                      </div>
                      <p className="text-[12px] text-[#898989] leading-[1.55]">
                        Import PNG → Texture Type: "Sprite" → Sprite Mode: "Multiple" → Sprite Editor → Slice → Grid by Cell Size → Apply.
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor size={14} className="text-[#3ecf8e]" />
                        <span className="text-[14px] font-medium text-[#fafafa] tracking-tight">Godot</span>
                      </div>
                      <p className="text-[12px] text-[#898989] leading-[1.55]">
                        AnimatedSprite2D → SpriteFrames → Add from Sheet → Select PNG → Set grid size → Pick frames per animation.
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor size={14} className="text-[#3ecf8e]" />
                        <span className="text-[14px] font-medium text-[#fafafa] tracking-tight">Phaser / PixiJS</span>
                      </div>
                      <p className="text-[12px] text-[#898989] leading-[1.55]">
                        Use the Aseprite atlas: <code className="text-[#3ecf8e] font-mono">this.load.aseprite('hero', 'spritesheet.png', 'spritesheet.aseprite.json')</code> — tags become animations automatically with correct durations.
                      </p>
                    </div>
                    <div className="rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor size={14} className="text-[#3ecf8e]" />
                        <span className="text-[14px] font-medium text-[#fafafa] tracking-tight">GameMaker / Other</span>
                      </div>
                      <p className="text-[12px] text-[#898989] leading-[1.55]">
                        Import PNG as grid-based sprite sheet. Use the frame size and row mapping shown above.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#2e2e2e] bg-[#171717] p-12 text-center text-[#898989]">
                No sprite sheet compiled yet.<br />Generate at least one animation row in step 2.
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
        <div
          className="fixed inset-0 flex items-center justify-center z-[100]"
          style={{ background: 'rgba(15, 15, 15, 0.65)', backdropFilter: 'blur(2px)' }}
        >
          <div
            className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4 text-center"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
          >
            <div className="w-12 h-12 rounded-full border border-[#3ecf8e]/30 bg-[#3ecf8e]/10 flex items-center justify-center">
              <RefreshCw className="animate-spin text-[#3ecf8e]" size={24} />
            </div>
            <div className="text-[18px] font-medium text-[#fafafa] tracking-tight">Thinking…</div>
            <p className="text-[13px] text-[#b4b4b4]">{loadingMsg}</p>
          </div>
        </div>
      )}

      {selectedFrame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
          style={{ background: 'rgba(15, 15, 15, 0.55)' }}
          onClick={() => !isGenerating && setSelectedFrame(null)}
        >
          <div
            className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-6 max-w-xl w-full flex flex-col gap-5"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-card-title text-[#fafafa]">
                {animations[selectedFrame.rowIndex].name} · Frame {selectedFrame.frameIndex + 1}
              </h3>
              <button onClick={() => setSelectedFrame(null)} disabled={isGenerating} className="text-[#898989] hover:text-[#fafafa] transition-colors"><XCircle /></button>
            </div>
            <div
              className="w-full aspect-square rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] flex items-center justify-center"
              style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
            >
              <img src={selectedFrame.url} alt="Frame Zoom" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => handleRegenerateSingleFrame(selectedFrame.rowIndex, selectedFrame.frameIndex)}
                disabled={isGenerating}
                className="btn-brand !px-5"
              >
                {isGenerating ? 'Regenerating…' : 'Regenerate this frame'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Character Preview Popup */}
      {previewChar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
          style={{ background: 'rgba(15, 15, 15, 0.55)' }}
          onClick={() => setPreviewChar(null)}
        >
          <div
            className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-6 max-w-lg w-full flex flex-col gap-4"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="text-card-title text-[#fafafa] truncate">{previewChar.name}</h3>
              <button onClick={() => setPreviewChar(null)} className="text-[#898989] hover:text-[#fafafa] transition-colors"><XCircle /></button>
            </div>
            <div
              className="w-full aspect-square rounded-lg bg-[#0f0f0f] border border-[#2e2e2e] flex items-center justify-center"
              style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
            >
              <img src={previewChar.cleanImage} alt={previewChar.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#0f0f0f] border border-[#2e2e2e] px-2.5 py-1 font-mono text-[11px] text-[#b4b4b4]">{ART_STYLES.find(s => s.id === previewChar.artStyle)?.label}</span>
              <span className="rounded-full bg-[#0f0f0f] border border-[#2e2e2e] px-2.5 py-1 font-mono text-[11px] text-[#b4b4b4]">{PERSPECTIVES.find(p => p.id === previewChar.perspective)?.label}</span>
              <span className="rounded-full bg-[#0f0f0f] border border-[#2e2e2e] px-2.5 py-1 font-mono text-[11px] text-[#b4b4b4]">{previewChar.group}</span>
            </div>
            {previewChar.prompt && <p className="text-[13px] text-[#898989] italic leading-[1.55]">“{previewChar.prompt}”</p>}
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
                className="btn-secondary flex-1 !px-3">
                <RefreshCw size={13} /> {isGenerating ? 'Generating…' : 'Regenerate'}
              </button>
              <button onClick={() => { const a = document.createElement('a'); a.href = previewChar.cleanImage; a.download = `${previewChar.name}.png`; a.click(); }}
                className="btn-secondary flex-1 !px-3">
                <Download size={13} /> Save image
              </button>
              <button onClick={() => { handleSelectChar(previewChar.id); setPreviewChar(null); }}
                className="btn-brand flex-1 !px-3">
                <ChevronRight size={13} /> Use this hero
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
