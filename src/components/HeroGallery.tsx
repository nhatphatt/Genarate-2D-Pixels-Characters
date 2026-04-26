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
  animations: { id: string; name: string; customPrompt: string }[];
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

const TRANSPARENT_BG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYNgNwMjAH+hkhhGjGoCGMTIwyMCM+MvA8I+BgUFBwYGBgeEjI8M/EJoBj0QOQZzJ4C8AAAAASUVORK5CYII=';

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
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-black uppercase tracking-widest text-2xl flex items-center gap-2.5">
          <Users size={22} className="text-[#BDFF00]" />
          Your Heroes
          <span className="text-zinc-500 text-sm font-mono tabular-nums">({savedChars.length})</span>
        </h2>

        {showNewGroup ? (
          <div className="flex gap-1 ml-auto">
            <input
              value={newGroupInput}
              onChange={e => setNewGroupInput(e.target.value)}
              placeholder="Group name..."
              autoFocus
              className="bg-[#0D0D0D] border-2 border-zinc-700 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#BDFF00] w-44"
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateGroup();
                if (e.key === 'Escape') setShowNewGroup(false);
              }}
            />
            <button onClick={handleCreateGroup}
              className="px-2 py-1.5 bg-[#BDFF00] text-black border-2 border-[#BDFF00]"><Check size={12} /></button>
            <button onClick={() => setShowNewGroup(false)}
              className="px-2 py-1.5 bg-zinc-800 text-zinc-400 border-2 border-zinc-700"><XCircle size={12} /></button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewGroup(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-[#161616] text-zinc-400 hover:text-white border-2 border-zinc-800 hover:border-zinc-600 font-black uppercase tracking-widest text-[11px] transition-colors"
          >
            <FolderPlus size={12} /> New Group
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
              className={`flex items-center gap-2 mb-3 py-2 px-3 bg-[#161616] border-2 transition-colors
                ${dragOverGroup === group ? 'border-[#BDFF00] bg-[#BDFF00]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <button onClick={() => onToggleGroup(group)} className="flex items-center gap-2 flex-1 min-w-0">
                {collapsed
                  ? <ChevronRight size={14} className="text-zinc-500 shrink-0" />
                  : <ChevronDown size={14} className="text-zinc-500 shrink-0" />}
                {renamingGroup === group ? (
                  <input
                    value={renameGroupVal}
                    onChange={e => setRenameGroupVal(e.target.value)}
                    autoFocus
                    className="bg-[#0D0D0D] border border-zinc-700 px-2 py-0.5 text-sm font-black uppercase tracking-widest text-[#BDFF00] focus:outline-none focus:border-[#BDFF00] w-44"
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameGroup(group);
                      if (e.key === 'Escape') setRenamingGroup(null);
                    }}
                    onBlur={() => handleRenameGroup(group)}
                  />
                ) : (
                  <span className="font-black uppercase tracking-widest text-sm text-[#BDFF00] truncate">{group}</span>
                )}
                <span className="font-mono text-xs text-zinc-500 shrink-0 tabular-nums">({chars.length})</span>
              </button>
              {dragCharId && <span className="font-mono text-[10px] text-[#BDFF00] uppercase shrink-0">Drop here</span>}
              {!dragCharId && group !== 'Ungrouped' && renamingGroup !== group && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); setRenamingGroup(group); setRenameGroupVal(group); }}
                    className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                    title="Rename group"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteGroup(group); }}
                    className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
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
                <div className="border-2 border-dashed border-zinc-800 py-8 text-center">
                  <p className="font-mono text-xs text-zinc-600">Empty group — drag a hero here.</p>
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
                        className={`group relative bg-[#161616] border-2 transition-all cursor-grab active:cursor-grabbing flex flex-col
                          ${isActive
                            ? 'border-[#BDFF00] shadow-[4px_4px_0_#BDFF00]'
                            : 'border-zinc-800 hover:border-zinc-600 hover:shadow-[2px_2px_0_#262626]'}
                          ${isDragging ? 'opacity-40' : ''}`}
                      >
                        {/* Active badge */}
                        {isActive && (
                          <span className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-[#BDFF00] text-black px-1.5 py-0.5 font-black uppercase tracking-widest text-[9px]">
                            <Check size={10} /> Active
                          </span>
                        )}

                        {/* Image */}
                        <div
                          className="relative aspect-[4/5] bg-[#0D0D0D] border-b border-zinc-800 overflow-hidden cursor-pointer"
                          style={{ backgroundImage: `url(${TRANSPARENT_BG_PNG})` }}
                          onClick={() => onPreviewChar(c)}
                        >
                          <img
                            src={c.cleanImage}
                            alt={c.name}
                            className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <button
                            className="absolute bottom-2 right-2 p-1.5 bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black"
                            title="Preview"
                            onClick={(e) => { e.stopPropagation(); onPreviewChar(c); }}
                          >
                            <Eye size={12} />
                          </button>
                          {/* Style/perspective tags */}
                          <div className="absolute top-2 right-2 flex flex-col gap-1 items-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="bg-black/70 text-zinc-300 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                              {ART_STYLES.find(s => s.id === c.artStyle)?.label}
                            </span>
                            <span className="bg-black/70 text-zinc-300 px-1.5 py-0.5 font-mono text-[9px] uppercase">
                              {PERSPECTIVES.find(p => p.id === c.perspective)?.label}
                            </span>
                          </div>
                        </div>

                        {/* Info + actions */}
                        <div className="p-2.5 flex flex-col gap-2">
                          {renamingChar === c.id ? (
                            <input
                              value={renameCharVal}
                              onChange={e => setRenameCharVal(e.target.value)}
                              autoFocus
                              className="w-full bg-[#0D0D0D] border border-zinc-700 px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-[#BDFF00]"
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRenameChar(c.id);
                                if (e.key === 'Escape') setRenamingChar(null);
                              }}
                              onBlur={() => handleRenameChar(c.id)}
                            />
                          ) : (
                            <button
                              className="text-left font-mono text-xs text-zinc-300 truncate hover:text-white transition-colors"
                              title="Click to rename"
                              onClick={() => { setRenamingChar(c.id); setRenameCharVal(c.name); }}
                            >
                              {c.name}
                            </button>
                          )}

                          <div className="flex gap-1.5">
                            <button
                              onClick={() => onSelectChar(c.id)}
                              className={`flex-1 text-[11px] font-black uppercase tracking-widest py-2 border transition-colors flex items-center justify-center gap-1
                                ${isActive
                                  ? 'bg-[#BDFF00] text-black border-[#BDFF00]'
                                  : 'bg-zinc-800 text-white border-zinc-700 hover:bg-[#BDFF00] hover:text-black hover:border-[#BDFF00]'}`}
                            >
                              <Play size={11} /> {isActive ? 'Active' : 'Animate'}
                            </button>
                            <button
                              onClick={() => onDeleteChar(c.id)}
                              className="px-2 py-2 bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-red-900/60 hover:text-red-200 hover:border-red-800 transition-colors"
                              title="Delete hero"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {/* Group select - subtle */}
                          <select
                            value={c.group}
                            onChange={e => onMoveCharToGroup(c.id, e.target.value)}
                            className="w-full bg-[#0D0D0D] border border-zinc-800 px-1.5 py-1 text-[10px] font-mono text-zinc-500 focus:outline-none focus:border-zinc-600 hover:text-zinc-400 cursor-pointer"
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
