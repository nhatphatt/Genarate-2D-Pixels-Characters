import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Zap, Download, ArrowRight, XCircle, ZoomIn } from 'lucide-react';
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
    title: 'Full sprite sheet',
    desc: 'Auto-generate idle, walk, run, attack, jump, hurt, death animations from one base.',
  },
  {
    icon: Download,
    title: 'Engine-ready',
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
      {/* Subtle radial brand glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 800px 400px at 50% -10%, rgba(62, 207, 142, 0.08), transparent 60%)',
        }}
      />

      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 py-16 lg:py-24 px-4">
        {/* LEFT: hero copy + CTA */}
        <div className="lg:col-span-7 flex flex-col justify-center">
          {/* Tag */}
          <div className="inline-flex items-center gap-2 self-start mb-6 px-3 py-1 rounded-full border border-[#3ecf8e]/30 bg-[#3ecf8e]/5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
            <span className="label-mono-brand">Powered by Gemini</span>
          </div>

          {/* Hero — 1.00 line-height (the typographic signature) */}
          <h2 className="text-display text-[#fafafa] mb-6">
            Generate <span className="text-[#3ecf8e]">2D pixel heroes</span>
            <br />
            and full sprite sheets in seconds.
          </h2>

          <p className="text-[16px] text-[#b4b4b4] max-w-xl mb-10 leading-[1.5]">
            Describe a character. Pick a style and perspective. We'll generate the base art,
            animate every action, and pack it all into a clean sprite sheet ready for your engine.
          </p>

          <div className="flex flex-wrap items-center gap-4 mb-14">
            <button onClick={onStart} className="btn-brand group !px-8 !py-2.5">
              Create your first hero
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <span className="text-[13px] text-[#898989]">
              No setup · Free with Gemini API
            </span>
          </div>

          {/* Features grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-[#2e2e2e] bg-[#171717] p-5 hover:border-[#363636] transition-colors"
              >
                <f.icon size={18} className="text-[#3ecf8e] mb-3" />
                <div className="text-[15px] font-medium text-[#fafafa] mb-1.5 tracking-tight">
                  {f.title}
                </div>
                <p className="text-[13px] text-[#898989] leading-[1.5]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: showcase grid */}
        <div className="lg:col-span-5 relative">
          <div className="grid grid-cols-3 gap-4">
            {SHOWCASE.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(item)}
                aria-label={`Preview ${item.label}`}
                className="group relative rounded-lg border border-[#2e2e2e] bg-[#171717] aspect-square overflow-hidden hover:border-[#3ecf8e]/40 transition-colors cursor-zoom-in focus:outline-none focus:border-[#3ecf8e]/60"
              >
                {/* Checker bg */}
                <div className="absolute inset-0 opacity-[0.04] bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')]" />

                {/* Top kind tag */}
                <span className="absolute top-2 left-2 z-10 rounded-sm bg-[#0f0f0f]/80 text-[#b4b4b4] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1.2px] border border-[#2e2e2e]">
                  {item.kind}
                </span>

                {/* Zoom icon */}
                <span className="absolute top-2 right-2 z-10 p-1 rounded-sm bg-[#0f0f0f]/80 text-[#b4b4b4] opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
                  <ZoomIn size={11} />
                </span>

                {/* Image */}
                <img
                  src={item.src}
                  alt={item.label}
                  className="relative w-full h-full object-contain p-3 group-hover:scale-[1.04] transition-transform duration-300"
                  style={{ imageRendering: 'pixelated' }}
                />

                {/* Bottom info bar */}
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-1.5 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/85 to-transparent pointer-events-none">
                  <div className="text-[12px] font-medium text-[#fafafa] truncate">
                    {item.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lightbox — portaled to <body> so it always centers on the viewport,
          regardless of any transformed/filtered ancestors in the page tree. */}
      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in"
          style={{ background: 'rgba(15, 15, 15, 0.55)' }}
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.label} preview`}
        >
          <div
            className="rounded-xl border border-[#2e2e2e] bg-[#171717] max-w-2xl w-full flex flex-col"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 h-14 border-b border-[#2e2e2e] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-sm bg-[#3ecf8e]/10 text-[#3ecf8e] border border-[#3ecf8e]/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1.2px] shrink-0">
                  {lightbox.kind}
                </span>
                <h3 className="text-[15px] font-medium text-[#fafafa] truncate">
                  {lightbox.label}
                </h3>
              </div>
              <button
                onClick={() => setLightbox(null)}
                className="text-[#898989] hover:text-[#fafafa] transition-colors p-1"
                aria-label="Close"
              >
                <XCircle size={20} />
              </button>
            </div>

            {/* Image — lighter neutral surface so sprite art reads clearly.
                Checker overlay sits at low opacity above so it suggests transparency
                without darkening the artwork. */}
            <div className="relative bg-[#1c1c1c] flex items-center justify-center p-6 sm:p-10">
              <div
                className="absolute inset-0 opacity-[0.06] pointer-events-none"
                style={{
                  backgroundImage:
                    "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=')",
                }}
              />
              <img
                src={lightbox.src}
                alt={lightbox.label}
                className="relative max-w-full max-h-[60vh] object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            {/* Description */}
            <div className="px-5 py-4 border-t border-[#2e2e2e]">
              <p className="text-[13px] text-[#b4b4b4] leading-[1.55]">
                {lightbox.description}
              </p>
              <p className="font-mono text-[11px] text-[#4d4d4d] mt-3 text-center tracking-[1.2px] uppercase">
                Press <kbd className="px-1.5 py-0.5 rounded-sm bg-[#1c1c1c] text-[#b4b4b4] border border-[#2e2e2e]">Esc</kbd> or click outside to close
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
