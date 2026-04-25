import { useState, useEffect, type ChangeEvent } from 'react';
import { ART_STYLES, PERSPECTIVES, type ArtStyle, type Perspective } from '../services/ai';
import { PERSPECTIVE_IMAGES, STYLE_IMAGES, PERSPECTIVE_TIPS, STYLE_TIPS } from './StyleIcons';
import { XCircle, Upload, Sparkles, Users, Info } from 'lucide-react';

interface NewHeroDrawerProps {
  open: boolean;
  onClose: () => void;
  isGenerating: boolean;
  loadingMsg: string;

  // form state (lifted to parent so it persists across open/close)
  charPrompt: string;
  setCharPrompt: (v: string) => void;
  artStyle: ArtStyle;
  setArtStyle: (s: ArtStyle) => void;
  perspective: Perspective;
  setPerspective: (p: Perspective) => void;
  batchMode: boolean;
  setBatchMode: (b: boolean) => void;
  batchContext: string;
  setBatchContext: (v: string) => void;
  batchNames: string;
  setBatchNames: (v: string) => void;

  onGenerate: () => void;
  onBatchGenerate: () => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function NewHeroDrawer(props: NewHeroDrawerProps) {
  const {
    open, onClose, isGenerating, loadingMsg,
    charPrompt, setCharPrompt, artStyle, setArtStyle, perspective, setPerspective,
    batchMode, setBatchMode, batchContext, setBatchContext, batchNames, setBatchNames,
    onGenerate, onBatchGenerate, onUpload,
  } = props;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isGenerating) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isGenerating, onClose]);

  const [showStyleTip, setShowStyleTip] = useState<string | null>(null);
  const [showPerspectiveTip, setShowPerspectiveTip] = useState<string | null>(null);

  const batchCount = batchNames.split('\n').filter(s => s.trim()).length;
  const canGenerate = batchMode ? batchCount > 0 : charPrompt.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => !isGenerating && onClose()}
        className={`fixed inset-0 bg-black/70 backdrop-blur-sm z-40 transition-opacity duration-300
          ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create new hero"
        className={`fixed top-0 right-0 h-full w-full sm:w-[440px] bg-[#0D0D0D] border-l-2 border-zinc-800 z-50 shadow-[-8px_0_24px_rgba(0,0,0,0.6)]
          flex flex-col transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b-2 border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#BDFF00]" />
            <h2 className="font-black uppercase tracking-widest text-sm text-white">New Hero</h2>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative cursor-pointer">
              <input type="file" accept="image/*" onChange={onUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <span className="flex items-center gap-1.5 bg-zinc-800 text-white hover:bg-zinc-700 px-3 py-1.5 font-black uppercase tracking-widest text-[10px] transition-colors border border-zinc-700">
                <Upload size={12} /> Upload
              </span>
            </label>
            <button
              onClick={() => !isGenerating && onClose()}
              className="text-zinc-500 hover:text-white transition-colors p-1"
              aria-label="Close"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Mode toggle */}
          <div>
            <div className="flex gap-1.5 bg-[#161616] border-2 border-zinc-800 p-1">
              <button onClick={() => setBatchMode(false)}
                className={`flex-1 py-2 font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-1.5
                  ${!batchMode ? 'bg-[#BDFF00] text-black' : 'bg-transparent text-zinc-500 hover:text-zinc-300'}`}>
                <Sparkles size={11} /> Single
              </button>
              <button onClick={() => setBatchMode(true)}
                className={`flex-1 py-2 font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-1.5
                  ${batchMode ? 'bg-[#BDFF00] text-black' : 'bg-transparent text-zinc-500 hover:text-zinc-300'}`}>
                <Users size={11} /> Batch
              </button>
            </div>
          </div>

          {/* Perspective */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="font-black uppercase tracking-widest text-[10px] text-zinc-400">Perspective</label>
              <span className="font-mono text-[10px] text-[#BDFF00]">
                {PERSPECTIVES.find(p => p.id === perspective)?.label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PERSPECTIVES.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPerspective(p.id)}
                  onMouseEnter={() => setShowPerspectiveTip(p.id)}
                  onMouseLeave={() => setShowPerspectiveTip(null)}
                  className={`relative p-2 border-2 transition-all flex flex-col items-center group h-[110px]
                    ${perspective === p.id
                      ? 'border-[#BDFF00] bg-[#BDFF00]/10'
                      : 'border-zinc-800 bg-[#161616] hover:border-zinc-600'}`}
                >
                  <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                    <img
                      src={PERSPECTIVE_IMAGES[p.id]}
                      alt={p.label}
                      className="w-16 h-16 object-contain group-hover:scale-105 transition-transform"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <span className={`font-black uppercase tracking-widest text-[9px] mt-1 ${perspective === p.id ? 'text-white' : 'text-zinc-500'}`}>
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
            {showPerspectiveTip && (
              <p className="mt-2 font-mono text-[10px] text-zinc-500 leading-relaxed flex gap-1.5">
                <Info size={11} className="shrink-0 mt-0.5 text-[#BDFF00]" />
                {PERSPECTIVE_TIPS[showPerspectiveTip]}
              </p>
            )}
          </section>

          {/* Art Style */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="font-black uppercase tracking-widest text-[10px] text-zinc-400">Art Style</label>
              <span className="font-mono text-[10px] text-[#BDFF00]">
                {ART_STYLES.find(s => s.id === artStyle)?.label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ART_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setArtStyle(s.id)}
                  onMouseEnter={() => setShowStyleTip(s.id)}
                  onMouseLeave={() => setShowStyleTip(null)}
                  className={`relative p-2 border-2 transition-all flex flex-col items-center group h-[110px]
                    ${artStyle === s.id
                      ? 'border-[#BDFF00] bg-[#BDFF00]/10'
                      : 'border-zinc-800 bg-[#161616] hover:border-zinc-600'}`}
                >
                  <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                    <img
                      src={STYLE_IMAGES[s.id]}
                      alt={s.label}
                      className="w-16 h-16 object-contain group-hover:scale-105 transition-transform"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <span className={`font-black uppercase tracking-widest text-[9px] mt-1 ${artStyle === s.id ? 'text-white' : 'text-zinc-500'}`}>
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
            {showStyleTip && (
              <p className="mt-2 font-mono text-[10px] text-zinc-500 leading-relaxed flex gap-1.5">
                <Info size={11} className="shrink-0 mt-0.5 text-[#BDFF00]" />
                {STYLE_TIPS[showStyleTip]}
              </p>
            )}
          </section>

          {/* Prompt area */}
          <section>
            <label className="block font-black uppercase tracking-widest text-[10px] text-zinc-400 mb-2">
              {batchMode ? 'Batch' : 'Describe Your Hero'}
            </label>
            {!batchMode ? (
              <textarea
                value={charPrompt}
                onChange={e => setCharPrompt(e.target.value)}
                placeholder="e.g. Cyberpunk rogue with a glowing katana, neon visor, hooded jacket"
                className="w-full bg-[#161616] border-2 border-zinc-800 p-3 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-sm h-28 resize-none"
              />
            ) : (
              <div className="space-y-2">
                <input
                  value={batchContext}
                  onChange={e => setBatchContext(e.target.value)}
                  placeholder="Universe / theme (e.g. Naruto, Marvel, Greek myth)"
                  className="w-full bg-[#161616] border-2 border-zinc-800 p-2.5 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-xs"
                />
                <textarea
                  value={batchNames}
                  onChange={e => setBatchNames(e.target.value)}
                  placeholder={'One name per line:\nNaruto Uzumaki\nSasuke Uchiha\nSakura Haruno'}
                  className="w-full bg-[#161616] border-2 border-zinc-800 p-3 text-[#E0E0E0] placeholder-zinc-600 focus:outline-none focus:border-[#BDFF00] font-mono text-xs h-28 resize-none"
                />
                <p className="font-mono text-[10px] text-zinc-500 flex items-center gap-1.5">
                  <Users size={10} />
                  {batchCount} character{batchCount !== 1 ? 's' : ''} queued
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Sticky footer CTA */}
        <div className="border-t-2 border-zinc-800 p-4 bg-[#0D0D0D] shrink-0">
          <button
            onClick={batchMode ? onBatchGenerate : onGenerate}
            disabled={isGenerating || !canGenerate}
            className="w-full bg-[#BDFF00] text-black font-black uppercase tracking-widest p-3.5 text-sm border-2 border-[#BDFF00] hover:bg-white hover:border-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#BDFF00] transition-all flex items-center justify-center gap-2"
          >
            <Sparkles size={14} />
            {isGenerating
              ? loadingMsg
              : batchMode
                ? `Generate ${batchCount || ''} Hero${batchCount === 1 ? '' : 's'}`
                : 'Generate Hero'}
          </button>
          <p className="font-mono text-[10px] text-zinc-600 mt-2 text-center">
            Press <kbd className="px-1 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700">Esc</kbd> to close
          </p>
        </div>
      </aside>
    </>
  );
}
