import { Users, RefreshCw, Play, Plus } from 'lucide-react';
import type { ComponentType } from 'react';

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

export function Header({
  appState,
  setAppState,
  activeChar,
  charCount,
  animationsDone,
  animationsTotal,
  hasSpriteSheet,
  onNewHero,
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
    <header className="border-b border-zinc-800 bg-[#0D0D0D]/85 backdrop-blur supports-[backdrop-filter]:bg-[#0D0D0D]/70 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 bg-[#BDFF00] flex items-center justify-center">
            <span className="text-black font-black text-xs leading-none">PX</span>
          </div>
          <h1 className="hidden sm:block font-black uppercase tracking-widest text-sm text-[#E0E0E0]">
            Pixel<span className="text-[#BDFF00]">Engine</span>
          </h1>
        </div>

        {/* Stepper */}
        <nav className="flex items-center gap-0 mx-auto" aria-label="Workflow steps">
          {STEPS.map((s, idx) => {
            const active = appState === s.state;
            const done = isStepDone(s.state) && !active;
            const disabled = isStepDisabled(s.state);
            const Icon = s.icon;
            const meta = stepMeta(s.state);
            return (
              <div key={s.state} className="flex items-center">
                <button
                  onClick={() => !disabled && setAppState(s.state)}
                  disabled={disabled}
                  aria-current={active ? 'step' : undefined}
                  className={`group flex items-center gap-2 h-9 px-2.5 sm:px-3 border transition-all
                    ${disabled ? 'opacity-30 cursor-not-allowed border-transparent text-zinc-600' : 'cursor-pointer'}
                    ${active
                      ? 'bg-[#BDFF00] text-black border-[#BDFF00] shadow-[0_0_0_1px_#BDFF00]'
                      : done
                        ? 'bg-[#161616] text-[#BDFF00] border-zinc-700 hover:border-[#BDFF00]/60'
                        : 'bg-[#161616] text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-white'}`}
                >
                  <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-black border
                    ${active ? 'border-black/70 bg-black/10' : done ? 'border-[#BDFF00]/60' : 'border-zinc-600'}`}>
                    {s.step}
                  </span>
                  <Icon size={13} />
                  <span className="hidden md:inline font-black uppercase tracking-widest text-[11px]">{s.label}</span>
                  {meta && (
                    <span className={`hidden sm:inline font-mono text-[10px] tabular-nums px-1
                      ${active ? 'text-black/70' : 'text-zinc-500'}`}>
                      {meta}
                    </span>
                  )}
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`h-px w-4 sm:w-6 transition-colors ${isStepDone(s.state) ? 'bg-[#BDFF00]' : 'bg-zinc-800'}`} />
                )}
              </div>
            );
          })}
        </nav>

        {/* Right slot */}
        <div className="flex items-center gap-2 shrink-0">
          {activeChar && (
            <div className="flex items-center gap-2 bg-[#161616] border border-zinc-800 pl-1 pr-2.5 py-1 max-w-[180px]">
              <div className="w-6 h-6 bg-[#0D0D0D] flex items-center justify-center shrink-0">
                <img src={activeChar.cleanImage} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
              </div>
              <span className="font-mono text-[11px] text-zinc-300 truncate">{activeChar.name}</span>
            </div>
          )}
          {onNewHero && appState === 'CREATE_CHAR' && (
            <button
              onClick={onNewHero}
              className="flex items-center gap-1.5 bg-[#BDFF00] text-black hover:bg-white transition-colors px-3 h-9 font-black uppercase tracking-widest text-[11px]"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">New Hero</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
