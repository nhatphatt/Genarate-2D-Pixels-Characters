import { useState } from 'react';
import {
  Users, FolderPlus, ChevronDown, ChevronRight, Pencil, Trash2,
  Check, XCircle, Eye, Play,
} from 'lucide-react';
import { ART_STYLES, PERSPECTIVES, type ArtStyle, type Perspective } from '../services/ai';

export interface SavedCharacter {
  id: string;
  name: string;
  prompt: string;
  group: string;
  artStyle: ArtStyle;
  perspective: Perspective;
  rawImage: string;
  cleanImage: string;
  animations: {
    id: string;
    name: string;
    customPrompt: string;
    /** Frames per second for engine playback. RFC-002 §G4. */
    fps: number;
    /** Loop behavior in the engine. RFC-002 §G4. */
    loop: 'forward' | 'pingpong' | 'once';
    /** KeyboardEvent.code that triggers this row in the in-app viewport.
     *  Empty string means "no hotkey" (locomotion rows handle their own
     *  arrow-key input; custom rows still get an in-app button). RFC-003. */
    keyBind: string;
  }[];
  /** Per-animation frame count (1..10). Index aligned with `animations`. */
  frameCounts: number[];
  animRows: any[];
  animRowsNoBg: (string | null)[];
  spriteSheet: string | null;
}

interface HeroGalleryProps {
  savedChars: SavedCharacter[];
  emptyGroups: string[];
  activeCharId: string | null;
  collapsedGroups: Set<string>;

  onSelectChar: (id: string) => void;
  onPreviewChar: (c: SavedCharacter) => void;
  onDeleteChar: (id: string) => void;

  onMoveCharToGroup: (charId: string, group: string) => void;
  onCreateGroup: (name: string) => void;
  onDeleteGroup: (group: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  onRenameChar: (id: string, name: string) => void;
  onToggleGroup: (group: string) => void;
}

const TRANSPARENT_BG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=';

export function HeroGallery(props: HeroGalleryProps) {
  const {
    savedChars, emptyGroups, activeCharId, collapsedGroups,
    onSelectChar, onPreviewChar, onDeleteChar,
    onMoveCharToGroup, onCreateGroup, onDeleteGroup, onRenameGroup, onRenameChar, onToggleGroup,
  } = props;

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState('');
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameGroupVal, setRenameGroupVal] = useState('');
  const [renamingChar, setRenamingChar] = useState<string | null>(null);
  const [renameCharVal, setRenameCharVal] = useState('');
  const [dragCharId, setDragCharId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  const groupedChars = (): Record<string, SavedCharacter[]> => {
    const groups: Record<string, SavedCharacter[]> = {};
    for (const g of emptyGroups) groups[g] ??= [];
    for (const c of savedChars) (groups[c.group] ??= []).push(c);
    return groups;
  };

  const allGroupNames = Object.keys(groupedChars());

  const handleCreateGroup = () => {
    const name = newGroupInput.trim();
    if (!name) return;
    onCreateGroup(name);
    setNewGroupInput('');
    setShowNewGroup(false);
  };

  const handleRenameGroup = (oldName: string) => {
    const newName = renameGroupVal.trim();
    if (!newName || newName === oldName) { setRenamingGroup(null); return; }
    onRenameGroup(oldName, newName);
    setRenamingGroup(null);
  };

  const handleRenameChar = (id: string) => {
    const n = renameCharVal.trim();
    if (!n) { setRenamingChar(null); return; }
    onRenameChar(id, n);
    setRenamingChar(null);
  };

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[28px] font-medium text-[#fafafa] tracking-tight flex items-center gap-2.5">
          <Users size={22} className="text-[#3ecf8e]" />
          Your heroes
          <span className="text-[#898989] text-[14px] font-mono tabular-nums">({savedChars.length})</span>
        </h2>

        {showNewGroup ? (
          <div className="flex gap-1.5 ml-auto">
            <input
              value={newGroupInput}
              onChange={e => setNewGroupInput(e.target.value)}
              placeholder="Group name…"
              autoFocus
              className="input-base !w-48 !py-1.5 !text-[12px]"
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateGroup();
                if (e.key === 'Escape') setShowNewGroup(false);
              }}
            />
            <button onClick={handleCreateGroup} className="btn-brand !px-2.5 !py-1.5 h-9"><Check size={14} /></button>
            <button onClick={() => setShowNewGroup(false)} className="btn-secondary !px-2.5 !py-1.5 h-9"><XCircle size={14} /></button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewGroup(true)}
            className="ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-[#171717] border border-[#2e2e2e] text-[13px] text-[#b4b4b4] hover:text-[#fafafa] hover:border-[#363636] transition-colors"
          >
            <FolderPlus size={13} /> New group
          </button>
        )}
      </div>

      {/* Groups */}
      {Object.entries(groupedChars()).map(([group, chars]) => {
        const collapsed = collapsedGroups.has(group);
        return (
          <section key={group}>
            {/* Group header */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOverGroup(group); }}
              onDragLeave={() => setDragOverGroup(null)}
              onDrop={e => {
                e.preventDefault();
                if (dragCharId) { onMoveCharToGroup(dragCharId, group); setDragCharId(null); }
                setDragOverGroup(null);
              }}
              className={`flex items-center gap-2 mb-4 py-2 px-3 rounded-md border transition-colors
                ${dragOverGroup === group ? 'border-[#3ecf8e]/40 bg-[#3ecf8e]/5' : 'border-[#2e2e2e] bg-[#171717] hover:border-[#363636]'}`}
            >
              <button onClick={() => onToggleGroup(group)} className="flex items-center gap-2 flex-1 min-w-0">
                {collapsed
                  ? <ChevronRight size={14} className="text-[#898989] shrink-0" />
                  : <ChevronDown size={14} className="text-[#898989] shrink-0" />}
                {renamingGroup === group ? (
                  <input
                    value={renameGroupVal}
                    onChange={e => setRenameGroupVal(e.target.value)}
                    autoFocus
                    className="input-base !w-48 !py-1 !text-[13px]"
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameGroup(group);
                      if (e.key === 'Escape') setRenamingGroup(null);
                    }}
                    onBlur={() => handleRenameGroup(group)}
                  />
                ) : (
                  <span className="text-[14px] font-medium text-[#fafafa] truncate">{group}</span>
                )}
                <span className="font-mono text-[12px] text-[#898989] shrink-0 tabular-nums">({chars.length})</span>
              </button>
              {dragCharId && <span className="font-mono text-[10px] text-[#3ecf8e] uppercase tracking-[1.2px] shrink-0">Drop here</span>}
              {!dragCharId && group !== 'Ungrouped' && renamingGroup !== group && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setRenamingGroup(group); setRenameGroupVal(group); }}
                    className="p-1.5 rounded-md text-[#898989] hover:text-[#fafafa] hover:bg-[#1c1c1c] transition-colors"
                    title="Rename group"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteGroup(group); }}
                    className="p-1.5 rounded-md text-[#898989] hover:text-[hsl(348,75%,60%)] hover:bg-[#1c1c1c] transition-colors"
                    title="Delete group"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Cards */}
            {!collapsed && (
              chars.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#2e2e2e] py-10 text-center">
                  <p className="text-[13px] text-[#4d4d4d]">Empty group — drag a hero here.</p>
                </div>
              ) : (
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {chars.map(c => {
                    const isActive = c.id === activeCharId;
                    const isDragging = dragCharId === c.id;
                    return (
                      <article
                        key={c.id}
                        draggable
                        onDragStart={() => setDragCharId(c.id)}
                        onDragEnd={() => { setDragCharId(null); setDragOverGroup(null); }}
                        className={`group relative rounded-lg border transition-colors cursor-grab active:cursor-grabbing flex flex-col overflow-hidden
                          ${isActive
                            ? 'border-[#3ecf8e]/40 bg-[#171717]'
                            : 'border-[#2e2e2e] bg-[#171717] hover:border-[#363636]'}
                          ${isDragging ? 'opacity-40' : ''}`}
                      >
                        {/* Active badge */}
                        {isActive && (
                          <span className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-[#3ecf8e]/15 text-[#3ecf8e] border border-[#3ecf8e]/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1.2px]">
                            <Check size={10} /> Active
                          </span>
                        )}

                        {/* Image */}
                        <div
                          className="relative aspect-[4/5] bg-[#0f0f0f] border-b border-[#2e2e2e] overflow-hidden cursor-pointer"
                          style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
                          onClick={() => onPreviewChar(c)}
                        >
                          <img
                            src={c.cleanImage}
                            alt={c.name}
                            className="w-full h-full object-contain p-3 group-hover:scale-[1.04] transition-transform duration-300"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f]/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <button
                            className="absolute bottom-2 right-2 p-1.5 rounded-md bg-[#0f0f0f]/80 text-[#fafafa] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#0f0f0f] border border-[#2e2e2e]"
                            title="Preview"
                            onClick={(e) => { e.stopPropagation(); onPreviewChar(c); }}
                          >
                            <Eye size={12} />
                          </button>
                          {/* Style/perspective tags */}
                          <div className="absolute top-2 right-2 flex flex-col gap-1 items-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="rounded-sm bg-[#0f0f0f]/80 text-[#b4b4b4] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1.2px] border border-[#2e2e2e]">
                              {ART_STYLES.find(s => s.id === c.artStyle)?.label}
                            </span>
                            <span className="rounded-sm bg-[#0f0f0f]/80 text-[#b4b4b4] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1.2px] border border-[#2e2e2e]">
                              {PERSPECTIVES.find(p => p.id === c.perspective)?.label}
                            </span>
                          </div>
                        </div>

                        {/* Info + actions */}
                        <div className="p-3 flex flex-col gap-2.5">
                          {renamingChar === c.id ? (
                            <input
                              value={renameCharVal}
                              onChange={e => setRenameCharVal(e.target.value)}
                              autoFocus
                              className="input-base !py-1 !text-[13px]"
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRenameChar(c.id);
                                if (e.key === 'Escape') setRenamingChar(null);
                              }}
                              onBlur={() => handleRenameChar(c.id)}
                            />
                          ) : (
                            <button
                              className="text-left text-[13px] font-medium text-[#fafafa] truncate hover:text-[#3ecf8e] transition-colors"
                              title="Click to rename"
                              onClick={() => { setRenamingChar(c.id); setRenameCharVal(c.name); }}
                            >
                              {c.name}
                            </button>
                          )}

                          <div className="flex gap-1.5">
                            <button
                              onClick={() => onSelectChar(c.id)}
                              className={[
                                'flex-1 inline-flex items-center justify-center gap-1.5 rounded-full text-[12px] font-medium py-1.5 border transition-colors',
                                isActive
                                  ? 'bg-[#3ecf8e] text-[#0f0f0f] border-[#3ecf8e] hover:bg-[#00c573]'
                                  : 'bg-[#0f0f0f] text-[#fafafa] border-[#2e2e2e] hover:border-[#3ecf8e]/40',
                              ].join(' ')}
                            >
                              <Play size={11} /> {isActive ? 'Active' : 'Animate'}
                            </button>
                            <button
                              onClick={() => onDeleteChar(c.id)}
                              className="px-2.5 rounded-md bg-[#0f0f0f] text-[#898989] border border-[#2e2e2e] hover:text-[hsl(348,75%,65%)] hover:border-[hsl(348,75%,30%)] transition-colors"
                              title="Delete hero"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {/* Group select */}
                          <select
                            value={c.group}
                            onChange={e => onMoveCharToGroup(c.id, e.target.value)}
                            className="w-full bg-[#0f0f0f] border border-[#2e2e2e] rounded-md px-2 py-1 text-[11px] font-mono text-[#898989] focus:outline-none focus:border-[#363636] hover:text-[#b4b4b4] cursor-pointer"
                            title="Move to group"
                          >
                            {allGroupNames.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
