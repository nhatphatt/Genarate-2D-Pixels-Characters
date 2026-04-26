import { Users, RefreshCw, Play, Plus } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

export type AppState = 'CREATE_CHAR' | 'CREATE_ANIM' | 'PLAY';

interface ActiveCharLite {
  id: string;
  name: string;
  cleanImage: string;
}

interface HeaderProps {
  appState: AppState;
  setAppState: (s: AppState) => void;
  activeChar: ActiveCharLite | null;
  charCount: number;
  animationsDone: number;
  animationsTotal: number;
  hasSpriteSheet: boolean;
  onNewHero?: () => void;
  /** Optional slot for the project menu (export/import). RFC-002 §G2. */
  projectMenu?: ReactNode;
}

interface StepDef {
  step: number;
  state: AppState;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const STEPS: StepDef[] = [
  { step: 1, state: 'CREATE_CHAR', label: 'Characters', icon: Users },
  { step: 2, state: 'CREATE_ANIM', label: 'Animations', icon: RefreshCw },
  { step: 3, state: 'PLAY', label: 'Export', icon: Play },
];

/**
 * Brand mark — emerald square with white "P" glyph.
 * Green used as identity marker only (per Supabase guidelines).
 */
function BrandMark() {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="w-7 h-7 rounded-md bg-[#3ecf8e] flex items-center justify-center">
        <span className="text-[#0f0f0f] font-medium text-sm leading-none">P</span>
      </div>
      <h1 className="hidden sm:block text-[15px] font-medium text-[#fafafa] tracking-tight">
        Pixel<span className="text-[#3ecf8e]">Engine</span>
      </h1>
    </div>
  );
}

export function Header({
  appState,
  setAppState,
  activeChar,
  charCount,
  animationsDone,
  animationsTotal,
  hasSpriteSheet,
  onNewHero,
  projectMenu,
}: HeaderProps) {
  const isStepDisabled = (s: AppState) => {
    if (s === 'CREATE_CHAR') return false;
    if (!activeChar) return true;
    return false;
  };

  const isStepDone = (s: AppState) => {
    if (s === 'CREATE_CHAR') return charCount > 0;
    if (s === 'CREATE_ANIM') return animationsDone === animationsTotal && animationsTotal > 0;
    if (s === 'PLAY') return hasSpriteSheet;
    return false;
  };

  const stepMeta = (s: AppState) => {
    if (s === 'CREATE_CHAR') return charCount > 0 ? `${charCount}` : '';
    if (s === 'CREATE_ANIM' && activeChar) return `${animationsDone}/${animationsTotal}`;
    return '';
  };

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#2e2e2e]"
      style={{ background: 'rgba(15, 15, 15, 0.80)', backdropFilter: 'blur(8px)' }}
    >
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        {/* Brand */}
        <BrandMark />

        {/* Stepper — pill tabs, Supabase-style */}
        <nav className="flex items-center gap-1 mx-auto" aria-label="Workflow steps">
          {STEPS.map((s) => {
            const active = appState === s.state;
            const done = isStepDone(s.state) && !active;
            const disabled = isStepDisabled(s.state);
            const Icon = s.icon;
            const meta = stepMeta(s.state);
            return (
              <button
                key={s.state}
                onClick={() => !disabled && setAppState(s.state)}
                disabled={disabled}
                aria-current={active ? 'step' : undefined}
                className={[
                  'group flex items-center gap-2 h-9 px-3 rounded-full border text-[13px] font-medium transition-colors',
                  disabled ? 'opacity-30 cursor-not-allowed border-transparent text-[#4d4d4d]' : 'cursor-pointer',
                  active
                    ? 'bg-[#1c1c1c] border-[#393939] text-[#fafafa]'
                    : done
                      ? 'border-transparent text-[#3ecf8e] hover:bg-[#1c1c1c]'
                      : 'border-transparent text-[#898989] hover:text-[#fafafa] hover:bg-[#1c1c1c]',
                ].join(' ')}
              >
                <span
                  className={[
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border',
                    active
                      ? 'border-[#3ecf8e]/40 bg-[#3ecf8e]/10 text-[#3ecf8e]'
                      : done
                        ? 'border-[#3ecf8e]/40 text-[#3ecf8e]'
                        : 'border-[#2e2e2e] text-[#898989]',
                  ].join(' ')}
                >
                  {s.step}
                </span>
                <Icon size={13} />
                <span className="hidden md:inline">{s.label}</span>
                {meta && (
                  <span className="hidden sm:inline font-mono text-[11px] tabular-nums text-[#898989]">
                    {meta}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right slot */}
        <div className="flex items-center gap-2 shrink-0">
          {projectMenu}
          {activeChar && (
            <div className="hidden sm:flex items-center gap-2 bg-[#1c1c1c] border border-[#2e2e2e] rounded-md pl-1 pr-3 py-1 max-w-[200px]">
              <div className="w-6 h-6 rounded-sm bg-[#0f0f0f] flex items-center justify-center shrink-0">
                <img
                  src={activeChar.cleanImage}
                  alt=""
                  className="w-full h-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <span className="text-[12px] text-[#b4b4b4] truncate">{activeChar.name}</span>
            </div>
          )}
          {onNewHero && appState === 'CREATE_CHAR' && (
            <button onClick={onNewHero} className="btn-brand h-9 !py-0">
              <Plus size={14} />
              <span className="hidden sm:inline">Start your hero</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
