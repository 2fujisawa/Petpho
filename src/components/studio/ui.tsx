"use client";

import { MODELS, type ModelConfig, type ModelId } from "@/lib/models";

// ── Shared class strings ─────────────────────────────────────────────────
// One place for the recurring visual treatments so a tweak lands everywhere.
export const label = "text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.14em]";
export const chipOff =
  "bg-black/[0.035] border-transparent text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-800";
export const chipOn = "bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-500/25";
export const floatCard =
  "bg-white rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_rgba(0,0,0,0.06)]";
export const selectBox =
  "w-full appearance-none text-xs font-semibold text-zinc-800 bg-black/[0.035] rounded-xl pl-3 pr-7 py-2 cursor-pointer transition-colors hover:bg-black/[0.06] focus:outline-none focus:ring-2 focus:ring-orange-400/30";
// Everything that floats over a thumbnail shares one neutral treatment — the
// badges aren't colour-coded by model any more.
export const overlayChip =
  "bg-white/15 hover:bg-white/30 backdrop-blur-sm text-white transition-colors";
export const errorBox =
  "text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 animate-fade-in";

// ── Model pickers ────────────────────────────────────────────────────────

// Chip row — one pill per model.
export function ModelSwitcher({
  value,
  onChange,
  models = MODELS,
  title = "Model",
}: {
  value: ModelId;
  onChange: (id: ModelId) => void;
  models?: ModelConfig[];
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className={label}>{title}</label>
      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <button key={m.id} onClick={() => onChange(m.id)}
            title={`${m.provider} — ${m.description}`}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 whitespace-nowrap ${
              value === m.id ? chipOn : chipOff
            }`}>
            {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chevron() {
  return (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-[9px]">
      ▼
    </span>
  );
}

// Space-efficient stand-in for ModelSwitcher — a native select instead of chips.
export function ModelDropdown({
  value, onChange, models, title,
}: {
  value: ModelId;
  onChange: (id: ModelId) => void;
  models: ModelConfig[];
  title: string;
}) {
  const current = models.find((m) => m.id === value);
  return (
    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
      <label className={label}>{title}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as ModelId)}
          title={current ? `${current.provider} — ${current.description}` : undefined}
          className={selectBox}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <Chevron />
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────

export function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="21" y1="4" x2="14" y2="4" /><line x1="10" y1="4" x2="3" y2="4" />
      <line x1="21" y1="12" x2="12" y2="12" /><line x1="8" y1="12" x2="3" y2="12" />
      <line x1="21" y1="20" x2="16" y2="20" /><line x1="12" y1="20" x2="3" y2="20" />
      <line x1="14" y1="2" x2="14" y2="6" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="16" y1="18" x2="16" y2="22" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

// ── Gallery toolbar pieces ───────────────────────────────────────────────

export function GridSizeSlider({ columns, onChange }: { columns: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-full pl-3 pr-2 py-1.5 shadow-sm flex-shrink-0" title="Adjust how many photos show per row">
      <span className="text-xs text-zinc-500">🔳</span>
      <input type="range" min={2} max={8} value={columns}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20" />
      <span className="text-[11px] text-zinc-500 font-semibold w-4 text-center">{columns}</span>
    </div>
  );
}

export function SelectToolbar({
  selectMode, selectedCount, onToggle, onSelectAll, onDelete,
}: {
  selectMode: boolean;
  selectedCount: number;
  onToggle: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
}) {
  if (!selectMode) {
    return (
      <button onClick={onToggle}
        className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 bg-black/[0.035] text-zinc-600 hover:text-zinc-800 hover:bg-black/[0.06] flex-shrink-0">
        Select
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-xs text-zinc-500 font-medium whitespace-nowrap">{selectedCount} selected</span>
      <button onClick={onSelectAll}
        className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 bg-black/[0.035] text-zinc-600 hover:text-zinc-800 hover:bg-black/[0.06]">
        Select all
      </button>
      <button onClick={onDelete} disabled={selectedCount === 0}
        className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 bg-red-500 text-white hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed">
        Delete{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>
      <button onClick={onToggle}
        className="text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.06]">
        Cancel
      </button>
    </div>
  );
}
