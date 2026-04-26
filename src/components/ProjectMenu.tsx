/**
 * Project menu — small popover in the header for export/import.
 *
 * RFC-002 §G2.
 *
 * Exposes:
 *   - Export project (.json) with a size estimate
 *   - Import project (.json) with merge/replace mode
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, Upload, FolderOpen, AlertTriangle, X } from 'lucide-react';
import {
  downloadProjectFile,
  estimateProjectSize,
  formatBytes,
  parseProjectFile,
  applyImport,
  ProjectImportError,
  type ImportMode,
} from '../lib/projectFile';
import type { SavedCharacter } from './HeroGallery';

interface ProjectMenuProps {
  characters: SavedCharacter[];
  emptyGroups: string[];
  onImport: (next: { characters: SavedCharacter[]; emptyGroups: string[] }) => void;
  onError?: (msg: string) => void;
}

export function ProjectMenu({ characters, emptyGroups, onImport, onError }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const sizeBytes = estimateProjectSize(characters, emptyGroups);
  const charCount = characters.length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleExport = () => {
    if (charCount === 0) {
      onError?.('Nothing to export — create a character first.');
      return;
    }
    downloadProjectFile(characters, emptyGroups);
    setOpen(false);
  };

  const handlePickFile = () => fileRef.current?.click();

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f) return;
    setPendingFile(f);
  };

  const performImport = async (mode: ImportMode) => {
    if (!pendingFile) return;
    try {
      const text = await pendingFile.text();
      const project = parseProjectFile(text);
      const next = applyImport({ characters, emptyGroups }, project, mode);
      onImport(next);
      setPendingFile(null);
      setConfirmReplace(false);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof ProjectImportError ? e.message : (e as Error).message;
      onError?.(`Import failed: ${msg}`);
      setPendingFile(null);
      setConfirmReplace(false);
    }
  };

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="h-9 px-3 rounded-md border border-[#2e2e2e] bg-[#1c1c1c] hover:bg-[#222] text-[#fafafa] text-[12px] font-medium flex items-center gap-1.5 transition-colors"
        title="Project file"
      >
        <FolderOpen size={13} className="text-[#3ecf8e]" />
        <span className="hidden md:inline">Project</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 rounded-lg border border-[#2e2e2e] bg-[#171717] p-2 shadow-xl"
          style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
        >
          <button
            type="button"
            onClick={handleExport}
            disabled={charCount === 0}
            className="w-full flex items-start gap-3 p-2.5 rounded-md hover:bg-[#1c1c1c] disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors"
          >
            <Download size={16} className="text-[#3ecf8e] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#fafafa]">Export project (.json)</div>
              <div className="text-[11px] text-[#898989] font-mono mt-0.5">
                {charCount} {charCount === 1 ? 'character' : 'characters'} · ~{formatBytes(sizeBytes)}
              </div>
            </div>
          </button>

          <div className="h-px bg-[#2e2e2e] my-1" />

          <button
            type="button"
            onClick={handlePickFile}
            className="w-full flex items-start gap-3 p-2.5 rounded-md hover:bg-[#1c1c1c] text-left transition-colors"
          >
            <Upload size={16} className="text-[#3ecf8e] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#fafafa]">Import project (.json)</div>
              <div className="text-[11px] text-[#898989] mt-0.5">Restore from a previous export</div>
            </div>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Import-mode picker */}
      {pendingFile && !confirmReplace && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 15, 15, 0.65)', backdropFilter: 'blur(2px)' }}
          onClick={() => setPendingFile(null)}
        >
          <div
            className="rounded-xl border border-[#2e2e2e] bg-[#171717] p-6 max-w-md w-full flex flex-col gap-4"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[18px] font-medium text-[#fafafa] tracking-tight">Import project</h3>
              <button onClick={() => setPendingFile(null)} className="text-[#898989] hover:text-[#fafafa]">
                <X size={18} />
              </button>
            </div>
            <p className="text-[12px] text-[#b4b4b4] font-mono">{pendingFile.name}</p>

            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-md border border-[#2e2e2e] bg-[#0f0f0f] hover:bg-[#1c1c1c] cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="mt-1"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#fafafa]">Merge</div>
                  <div className="text-[11px] text-[#898989] mt-0.5">
                    Append imported characters. Keep current ones. Id collisions get fresh ids.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-md border border-[#2e2e2e] bg-[#0f0f0f] hover:bg-[#1c1c1c] cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="mt-1"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#fafafa] flex items-center gap-1.5">
                    Replace
                    <AlertTriangle size={12} className="text-amber-400" />
                  </div>
                  <div className="text-[11px] text-[#898989] mt-0.5">
                    Wipe current state ({charCount} {charCount === 1 ? 'character' : 'characters'}) and replace with the imported file.
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setPendingFile(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={() => {
                  if (importMode === 'replace' && charCount > 0) {
                    setConfirmReplace(true);
                  } else {
                    void performImport(importMode);
                  }
                }}
                className="btn-brand"
              >
                {importMode === 'replace' && charCount > 0 ? 'Continue' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace confirmation */}
      {pendingFile && confirmReplace && (
        <div
          className="fixed inset-0 z-[121] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 15, 15, 0.65)', backdropFilter: 'blur(2px)' }}
          onClick={() => setConfirmReplace(false)}
        >
          <div
            className="rounded-xl border border-amber-500/40 bg-[#171717] p-6 max-w-md w-full flex flex-col gap-4"
            style={{ boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-amber-400" />
              <h3 className="text-[18px] font-medium text-[#fafafa] tracking-tight">Replace everything?</h3>
            </div>
            <p className="text-[13px] text-[#b4b4b4]">
              This will permanently delete <strong className="text-[#fafafa]">{charCount}</strong> existing
              {charCount === 1 ? ' character' : ' characters'} and replace them with the imported project.
              This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmReplace(false)} className="btn-ghost">Back</button>
              <button
                onClick={() => void performImport('replace')}
                className="btn-brand"
                style={{ background: 'hsl(38, 92%, 50%)', borderColor: 'hsl(38, 92%, 50%)', color: '#0f0f0f' }}
              >
                Yes, replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
