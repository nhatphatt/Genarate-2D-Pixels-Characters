import { useState, useEffect } from 'react';
import { Sparkles, Zap, Download, ChevronRight, XCircle, ZoomIn } from 'lucide-react';
import { STYLE_IMAGES, PERSPECTIVE_IMAGES, STYLE_TIPS, PERSPECTIVE_TIPS } from './StyleIcons';

interface EmptyLandingProps {
  onStart: () => void;
}

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI-Powered',
    desc: 'Generate unique 2D pixel heroes from a single text prompt — Gemini handles the art.',
  },
  {
    icon: Zap,
    title: 'Full Sprite Sheet',
    desc: 'Auto-generate idle, walk, run, attack, jump, hurt, death animations — all from one base.',
  },
  {
    icon: Download,
    title: 'Engine-Ready',
    desc: 'Export PNG + JSON atlas. Drop into Unity, Godot, Phaser or PixiJS in seconds.',
  },
];

interface ShowcaseItem {
  src: string;
  kind: 'Perspective' | 'Style';
  label: string;
  description: string;
}

const SHOWCASE: ShowcaseItem[] = [
  { src: PERSPECTIVE_IMAGES.platformer, kind: 'Perspective', label: 'Platformer', description: PERSPECTIVE_TIPS.platformer },
  { src: STYLE_IMAGES.pixel, kind: 'Style', label: 'Pixel Art', description: STYLE_TIPS.pixel },
  { src: STYLE_IMAGES.chibi, kind: 'Style', label: 'Chibi', description: STYLE_TIPS.chibi },
  { src: PERSPECTIVE_IMAGES.isometric, kind: 'Perspective', label: 'Isometric', description: PERSPECTIVE_TIPS.isometric },
  { src: STYLE_IMAGES['detailed-pixel'], kind: 'Style', label: 'Detailed Pixel', description: STYLE_TIPS['detailed-pixel'] },
  { src: PERSPECTIVE_IMAGES['top-down'], kind: 'Perspective', label: 'Top-Down', description: PERSPECTIVE_TIPS['top-down'] },
];

export function EmptyLanding({ onStart }: EmptyLandingProps) {
  const [lightbox, setLightbox] = useState<ShowcaseItem | null>(null);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <div className="relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, #BDFF00 1px, transparent 1px), linear-gradient(to bottom, #BDFF00 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />

      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 py-10 lg:py-16 px-4">
        {/* LEFT: hero copy + CTA */}
        <div className="lg:col-span-7 flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 self-start mb-5 px-2.5 py-1 bg-[#BDFF00]/10 border border-[#BDFF00]/30">
            <span className="w-1.5 h-1.5 bg-[#BDFF00] animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#BDFF00]">
              Powered by Gemini
            </span>
          </div>

          <h2 className="font-black uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mb-5">
            Generate <span className="text-[#BDFF00]">2D pixel heroes</span>
            <br />
            and full sprite sheets in seconds.
          </h2>

          <p className="font-mono text-sm sm:text-base text-zinc-400 max-w-xl mb-8 leading-relaxed">
            Describe a character. Pick a style and perspective. We'll generate the base art,
            animate every action, and pack it all into a clean sprite sheet ready for your engine.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-10">
            <button
              onClick={onStart}
              className="group flex items-center gap-2 bg-[#BDFF00] text-black font-black uppercase tracking-widest text-sm px-6 py-3.5 border-2 border-[#BDFF00] hover:bg-white hover:border-white transition-all shadow-[4px_4px_0_#161616]"
            >
              Create your first hero
              <ChevronRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <span className="font-mono text-xs text-zinc-600">
              No setup • Free with Gemini API
            </span>
          </div>

          {/* Features grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-[#161616]/80 border border-zinc-800 p-4 hover:border-zinc-600 transition-colors"
              >
                <f.icon size={18} className="text-[#BDFF00] mb-2" />
                <div className="font-black uppercase tracking-widest text-xs text-white mb-1.5">
                  {f.title}
                </div>
                <p className="font-mono text-[11px] text-zinc-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: showcase grid — clickable, no offset to avoid visual collision */}
        <div className="lg:col-span-5 relative">
          <div className="grid grid-cols-3 gap-x-5 gap-y-5 sm:gap-x-6 sm:gap-y-6">
            {SHOWCASE.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(item)}
                aria-label={`Preview ${item.label}`}
                className="group relative bg-[#161616] border border-zinc-800 aspect-square overflow-hidden hover:border-[#BDFF00]/60 hover:shadow-[3px_3px_0_#BDFF00]/30 transition-all cursor-zoom-in focus:outline-none focus:border-[#BDFF00] focus:shadow-[3px_3px_0_#BDFF00]/40"
              >
                {/* Checker bg */}
                <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')] opacity-30" />

                {/* Top kind tag — always visible */}
                <span className="absolute top-1.5 left-1.5 z-10 bg-black/70 text-zinc-300 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border border-zinc-700">
                  {item.kind}
                </span>

                {/* Zoom icon — visible on hover */}
                <span className="absolute top-1.5 right-1.5 z-10 p-1 bg-black/70 text-white opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
                  <ZoomIn size={11} />
                </span>

                {/* Image */}
                <img
                  src={item.src}
                  alt={item.label}
                  className="relative w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                  style={{ imageRendering: 'pixelated' }}
                />

                {/* Bottom info bar — always visible */}
                <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-[#0D0D0D] via-[#0D0D0D]/90 to-transparent pointer-events-none">
                  <div className="font-black uppercase tracking-widest text-[10px] text-white truncate">
                    {item.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="absolute -inset-4 -z-10 bg-gradient-to-tr from-[#BDFF00]/5 via-transparent to-transparent blur-2xl pointer-events-none" />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.label} preview`}
        >
          <div
            className="bg-[#161616] border-4 border-zinc-800 max-w-2xl w-full flex flex-col shadow-[8px_8px_0_#BDFF00]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 h-14 border-b-2 border-zinc-800 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="bg-[#BDFF00]/15 text-[#BDFF00] border border-[#BDFF00]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest shrink-0">
                  {lightbox.kind}
                </span>
                <h3 className="font-black uppercase tracking-widest text-base text-white truncate">
                  {lightbox.label}
                </h3>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="text-zinc-500 hover:text-white transition-colors p-1"
                aria-label="Close"
              >
                <XCircle size={20} />
              </button>
            </div>

            {/* Image */}
            <div
              className="relative bg-[#0D0D0D] flex items-center justify-center p-6 sm:p-10"
              style={{
                backgroundImage:
                  "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')",
              }}
            >
              <img
                src={lightbox.src}
                alt={lightbox.label}
                className="max-w-full max-h-[60vh] object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            {/* Description */}
            <div className="px-5 py-4 border-t-2 border-zinc-800">
              <p className="font-mono text-xs text-zinc-400 leading-relaxed">
                {lightbox.description}
              </p>
              <p className="font-mono text-[10px] text-zinc-600 mt-3 text-center">
                Press <kbd className="px-1 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700">Esc</kbd> or click outside to close
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
