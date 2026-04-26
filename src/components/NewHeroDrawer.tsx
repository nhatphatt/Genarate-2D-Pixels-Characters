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
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(15, 15, 15, 0.55)' }}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create new hero"
        className={`fixed top-0 right-0 h-full w-full sm:w-[460px] z-50 flex flex-col transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{
          background: '#0f0f0f',
          borderLeft: '1px solid #2e2e2e',
          boxShadow: '-16px 0 48px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-[#2e2e2e] shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#3ecf8e]" />
            <h2 className="text-[15px] font-medium text-[#fafafa] tracking-tight">New Hero</h2>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative cursor-pointer">
              <input type="file" accept="image/*" onChange={onUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#2e2e2e] bg-[#171717] hover:bg-[#1c1c1c] hover:border-[#363636] px-3 py-1.5 text-[12px] font-medium text-[#b4b4b4] transition-colors">
                <Upload size={12} /> Upload
              </span>
            </label>
            <button
              onClick={() => !isGenerating && onClose()}
              className="text-[#898989] hover:text-[#fafafa] transition-colors p-1 rounded-md"
              aria-label="Close"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-7">
          {/* Mode toggle — pill tabs */}
          <div>
            <div className="inline-flex p-1 rounded-full border border-[#2e2e2e] bg-[#171717]">
              <button
                onClick={() => setBatchMode(false)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-medium transition-colors
                  ${!batchMode ? 'bg-[#1c1c1c] text-[#fafafa] border border-[#393939]' : 'text-[#898989] hover:text-[#fafafa] border border-transparent'}`}
              >
                <Sparkles size={11} /> Single
              </button>
              <button
                onClick={() => setBatchMode(true)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-medium transition-colors
                  ${batchMode ? 'bg-[#1c1c1c] text-[#fafafa] border border-[#393939]' : 'text-[#898989] hover:text-[#fafafa] border border-transparent'}`}
              >
                <Users size={11} /> Batch
              </button>
            </div>
          </div>

          {/* Perspective */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <label className="label-mono">Perspective</label>
              <span className="text-[12px] text-[#3ecf8e]">
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
                  className={`relative p-2 rounded-lg border transition-colors flex flex-col items-center group h-[112px]
                    ${perspective === p.id
                      ? 'border-[#3ecf8e]/40 bg-[#3ecf8e]/5'
                      : 'border-[#2e2e2e] bg-[#171717] hover:border-[#363636]'}`}
                >
                  <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                    <img
                      src={PERSPECTIVE_IMAGES[p.id]}
                      alt={p.label}
                      className="w-16 h-16 object-contain group-hover:scale-105 transition-transform"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium mt-1 ${perspective === p.id ? 'text-[#fafafa]' : 'text-[#898989]'}`}>
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
            {showPerspectiveTip && (
              <p className="mt-3 text-[12px] text-[#898989] leading-[1.55] flex gap-1.5">
                <Info size={12} className="shrink-0 mt-0.5 text-[#3ecf8e]" />
                {PERSPECTIVE_TIPS[showPerspectiveTip]}
              </p>
            )}
          </section>

          {/* Art Style */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <label className="label-mono">Art Style</label>
              <span className="text-[12px] text-[#3ecf8e]">
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
                  className={`relative p-2 rounded-lg border transition-colors flex flex-col items-center group h-[112px]
                    ${artStyle === s.id
                      ? 'border-[#3ecf8e]/40 bg-[#3ecf8e]/5'
                      : 'border-[#2e2e2e] bg-[#171717] hover:border-[#363636]'}`}
                >
                  <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                    <img
                      src={STYLE_IMAGES[s.id]}
                      alt={s.label}
                      className="w-16 h-16 object-contain group-hover:scale-105 transition-transform"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <span className={`text-[11px] font-medium mt-1 ${artStyle === s.id ? 'text-[#fafafa]' : 'text-[#898989]'}`}>
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
            {showStyleTip && (
              <p className="mt-3 text-[12px] text-[#898989] leading-[1.55] flex gap-1.5">
                <Info size={12} className="shrink-0 mt-0.5 text-[#3ecf8e]" />
                {STYLE_TIPS[showStyleTip]}
              </p>
            )}
          </section>

          {/* Prompt area */}
          <section>
            <label className="block label-mono mb-3">
              {batchMode ? 'Batch' : 'Describe Your Hero'}
            </label>
            {!batchMode ? (
              <textarea
                value={charPrompt}
                onChange={e => setCharPrompt(e.target.value)}
                placeholder="e.g. Cyberpunk rogue with a glowing katana, neon visor, hooded jacket"
                className="input-base h-28 resize-none leading-[1.5]"
              />
            ) : (
              <div className="space-y-2.5">
                <input
                  value={batchContext}
                  onChange={e => setBatchContext(e.target.value)}
                  placeholder="Universe / theme (e.g. Naruto, Marvel, Greek myth)"
                  className="input-base"
                />
                <textarea
                  value={batchNames}
                  onChange={e => setBatchNames(e.target.value)}
                  placeholder={'One name per line:\nNaruto Uzumaki\nSasuke Uchiha\nSakura Haruno'}
                  className="input-base h-28 resize-none leading-[1.5] font-mono text-[12px]"
                />
                <p className="text-[12px] text-[#898989] flex items-center gap-1.5">
                  <Users size={11} />
                  {batchCount} character{batchCount !== 1 ? 's' : ''} queued
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Sticky footer CTA */}
        <div className="border-t border-[#2e2e2e] p-4 bg-[#0f0f0f] shrink-0">
          <button
            onClick={batchMode ? onBatchGenerate : onGenerate}
            disabled={isGenerating || !canGenerate}
            className="btn-brand w-full !py-3"
          >
            <Sparkles size={14} />
            {isGenerating
              ? loadingMsg
              : batchMode
                ? `Generate ${batchCount || ''} Hero${batchCount === 1 ? '' : 's'}`
                : 'Generate Hero'}
          </button>
          <p className="font-mono text-[11px] text-[#4d4d4d] mt-3 text-center tracking-[1.2px] uppercase">
            Press <kbd className="px-1.5 py-0.5 rounded-sm bg-[#1c1c1c] text-[#b4b4b4] border border-[#2e2e2e]">Esc</kbd> to close
          </p>
        </div>
      </aside>
    </>
  );
}
