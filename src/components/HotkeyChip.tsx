/**
 * Hotkey capture chip.
 *
 * RFC-003 §UI: hotkey capture chip in step 2.
 *
 * Click → enters listening state → next keydown anywhere on the page sets
 * the binding. Escape cancels. Backspace/Delete clears.
 *
 * Locomotion rows pass `disabled` + a `staticLabel` ("Arrow keys",
 * "Space / W") so the user understands those rows aren't rebindable.
 *
 * The component is purely controlled — it never owns the value. The
 * parent (App.tsx) writes the new code into the animation row, which
 * triggers the debounced IndexedDB write.
 */
import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { RESERVED_KEY_CODES } from '../lib/storage';

interface HotkeyChipProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** When `disabled`, render this label instead of the value. */
  staticLabel?: string;
  /** When set, surface the message inside the chip instead of accepting
   *  the binding. Used by the parent to show "Reserved key" hints. */
  errorMessage?: string;
}

/**
 * Pretty-print a KeyboardEvent.code for the chip:
 *   "KeyJ"     → "J"
 *   "Digit1"   → "1"
 *   "Numpad5"  → "Num 5"
 *   "Space"    → "Space"
 *   "Backquote"→ "`"
 *   ""         → "—"
 */
export function formatKeyCode(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code === 'Backquote') return '`';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code === 'Backslash') return '\\';
  if (code === 'BracketLeft')  return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Semicolon')    return ';';
  if (code === 'Quote')        return "'";
  if (code === 'Comma')        return ',';
  if (code === 'Period')       return '.';
  if (code === 'Slash')        return '/';
  return code; // Space, Enter, Tab, F1..F12, Escape — pass through
}

export function HotkeyChip({ value, onChange, disabled, staticLabel, errorMessage }: HotkeyChipProps) {
  const [listening, setListening] = useState(false);
  const [reserved, setReserved] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(false);
        setReserved(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChange('');
        setListening(false);
        setReserved(null);
        return;
      }
      const code = e.code;
      if (!code) return;
      if (RESERVED_KEY_CODES.has(code)) {
        // Show the warning inside the chip and stay in listening mode so
        // the user can press a different key without re-clicking.
        setReserved(code);
        return;
      }
      onChange(code);
      setListening(false);
      setReserved(null);
    };
    // Capture phase so we win against any other keyboard listener
    // (e.g. the GameViewport's own keydown).
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [listening, onChange]);

  const display = (() => {
    if (listening && reserved) return `Reserved (${formatKeyCode(reserved)}) — try another`;
    if (listening) return 'Press a key…';
    if (errorMessage) return errorMessage;
    if (disabled && staticLabel) return staticLabel;
    return formatKeyCode(value);
  })();

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) setListening(true); }}
      onBlur={() => { setListening(false); setReserved(null); }}
      title={
        disabled
          ? 'Locomotion uses arrows + Shift / Space — not rebindable'
          : 'Click then press any key to set this row\'s in-app hotkey. Esc to cancel, Backspace to clear.'
      }
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono transition-colors',
        disabled
          ? 'border-[#2e2e2e] bg-[#0f0f0f] text-[#5a5a5a] cursor-not-allowed'
          : listening
            ? (reserved
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-[#3ecf8e]/60 bg-[#3ecf8e]/10 text-[#3ecf8e] animate-pulse')
            : 'border-[#2e2e2e] bg-[#0f0f0f] text-[#b4b4b4] hover:border-[#3ecf8e]/40 hover:text-[#fafafa] cursor-pointer',
      ].join(' ')}
    >
      <Keyboard size={11} />
      <span className="leading-none">{display}</span>
    </button>
  );
}
