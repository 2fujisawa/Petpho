"use client";

import Image from "next/image";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { MODELS, DEFAULT_MODEL, COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, getComposeModelConfig, getModelConfig, type ModelId, type ModelConfig } from "@/lib/models";
import { PREMADE_BACKGROUNDS } from "@/lib/premadeBackgrounds";

const ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
];

function aspectRatioToNumber(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

type GeneratedImage = {
  url: string;
  prompt: string;
  model: ModelId;
  sourceUrl?: string;
  uploadUrl?: string;
  createdAt?: number;
};

type EditorState = {
  sourceImage: GeneratedImage;
  editPrompt: string;
  aspectRatio: string; // "original" or e.g. "16:9" — non-original outpaints the canvas
  loading: boolean;
  error: string | null;
  results: GeneratedImage[];
};

type InpaintCanvasHandle = {
  getMaskDataUrl: () => string | null;
  clear: () => void;
};

const InpaintCanvas = forwardRef<
  InpaintCanvasHandle,
  { imageUrl: string; brushSize: number; tool: "brush" | "eraser" }
>(function InpaintCanvas({ imageUrl, brushSize, tool }, ref) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getMaskDataUrl: () => maskRef.current?.toDataURL("image/png") ?? null,
    clear: () => {
      const d = displayRef.current;
      const m = maskRef.current;
      if (!d || !m) return;
      d.getContext("2d")!.clearRect(0, 0, d.width, d.height);
      const mctx = m.getContext("2d")!;
      mctx.fillStyle = "#000";
      mctx.fillRect(0, 0, m.width, m.height);
    },
  }));

  function initCanvases(w: number, h: number) {
    const d = displayRef.current!;
    const m = maskRef.current!;
    d.width = w; d.height = h;
    m.width = w; m.height = h;
    const mctx = m.getContext("2d")!;
    mctx.fillStyle = "#000";
    mctx.fillRect(0, 0, w, h);
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = displayRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
      r: (brushSize / r.width) * c.width,
    };
  }

  function paint(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const { x, y, r } = getPos(e);
    const dctx = displayRef.current!.getContext("2d")!;
    const mctx = maskRef.current!.getContext("2d")!;
    dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2);
    if (tool === "brush") {
      dctx.fillStyle = "rgba(255, 80, 0, 0.5)"; dctx.fill();
      mctx.fillStyle = "#fff"; mctx.fill();
    } else {
      dctx.globalCompositeOperation = "destination-out";
      dctx.fillStyle = "rgba(0,0,0,1)"; dctx.fill();
      dctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = "#000"; mctx.fill();
    }
  }

  return (
    <div className="relative select-none rounded-2xl overflow-hidden ring-1 ring-orange-400/25">
      <img src={imageUrl} alt="Inpaint target" className="w-full h-auto block" draggable={false}
        onLoad={(e) => { const img = e.currentTarget; initCanvases(img.naturalWidth, img.naturalHeight); }} />
      <canvas ref={displayRef} className="absolute inset-0 w-full h-full cursor-crosshair" style={{ touchAction: "none" }}
        onMouseDown={(e) => { drawingRef.current = true; paint(e); }}
        onMouseMove={paint} onMouseUp={() => { drawingRef.current = false; }}
        onMouseLeave={() => { drawingRef.current = false; }} />
      <canvas ref={maskRef} className="hidden" />
    </div>
  );
});

type CutoutRefinerHandle = {
  toBlob: () => Promise<Blob | null>;
  reset: () => void;
};

// Manual touch-up for an automatic cutout: erase leftover background the model
// missed, or paint back parts of the pet it trimmed off. The untouched original
// is kept on an offscreen canvas to sample from when restoring.
const CutoutRefiner = forwardRef<
  CutoutRefinerHandle,
  {
    cutoutUrl: string;
    originalUrl: string;
    brushSize: number;
    tool: "erase" | "restore";
    zoom: number;
    onReady?: (w: number, h: number) => void;
  }
>(function CutoutRefiner({ cutoutUrl, originalUrl, brushSize, tool, zoom, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Created in an effect, not at render — this component still gets SSR'd.
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  // Natural pixel size of the cutout — the display size is this times zoom.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Held in a ref so the loader effect doesn't re-run (and re-fetch both
  // images) every time the parent hands over a fresh inline callback.
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });

  function drawCutout(img: HTMLImageElement) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }

  useImperativeHandle(ref, () => ({
    // Vercel rejects request bodies past ~4.5MB before the route ever runs, and
    // a browser-encoded 2048px RGBA PNG clears that easily. Shrink until it
    // fits rather than letting the save fail.
    toBlob: async () => {
      const c = canvasRef.current;
      if (!c) return null;
      const LIMIT = 4 * 1024 * 1024;

      const encode = (canvas: HTMLCanvasElement) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

      let blob = await encode(c);
      for (const scale of [0.75, 0.55, 0.4, 0.3]) {
        if (!blob || blob.size <= LIMIT) break;
        const small = document.createElement("canvas");
        small.width = Math.round(c.width * scale);
        small.height = Math.round(c.height * scale);
        const sctx = small.getContext("2d")!;
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(c, 0, 0, small.width, small.height);
        blob = await encode(small);
      }
      return blob;
    },
    reset: () => {
      const img = document.createElement("img");
      img.crossOrigin = "anonymous";
      img.onload = () => drawCutout(img);
      img.src = cutoutUrl;
    },
  }));

  // crossOrigin is required, otherwise the canvas is tainted and toBlob throws.
  useEffect(() => {
    setReady(false);
    let cancelled = false;
    const cut = document.createElement("img");
    const orig = document.createElement("img");
    cut.crossOrigin = "anonymous";
    orig.crossOrigin = "anonymous";

    let loaded = 0;
    const onBoth = () => {
      if (cancelled || ++loaded < 2) return;
      const c = canvasRef.current;
      if (!c) return;
      const w = cut.naturalWidth;
      const h = cut.naturalHeight;
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(cut, 0, 0);

      const o = document.createElement("canvas");
      o.width = w; o.height = h;
      o.getContext("2d")!.drawImage(orig, 0, 0, w, h);
      originalRef.current = o;

      const sc = document.createElement("canvas");
      sc.width = w; sc.height = h;
      scratchRef.current = sc;

      setDims({ w, h });
      setReady(true);
      onReadyRef.current?.(w, h);
    };
    cut.onload = onBoth;
    orig.onload = onBoth;
    cut.src = cutoutUrl;
    orig.src = originalUrl;
    return () => { cancelled = true; };
  }, [cutoutUrl, originalUrl]);

  function posOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
      radius: (brushSize / r.width) * c.width,
    };
  }

  function stroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !ready) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const { x, y, radius } = posOf(e);
    const last = lastRef.current ?? { x, y };

    if (tool === "erase") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = radius * 2;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    } else {
      // Stroke onto scratch, keep only the original's pixels inside that stroke
      // (source-in), then lay the result back over the working canvas.
      const sc = scratchRef.current;
      const orig = originalRef.current;
      if (!sc || !orig) return;
      const sctx = sc.getContext("2d")!;
      sctx.clearRect(0, 0, sc.width, sc.height);
      sctx.globalCompositeOperation = "source-over";
      sctx.lineCap = "round";
      sctx.lineJoin = "round";
      sctx.lineWidth = radius * 2;
      sctx.strokeStyle = "#000";
      sctx.beginPath();
      sctx.moveTo(last.x, last.y);
      sctx.lineTo(x, y);
      sctx.stroke();
      sctx.globalCompositeOperation = "source-in";
      sctx.drawImage(orig, 0, 0);
      ctx.drawImage(sc, 0, 0);
    }
    lastRef.current = { x, y };
  }

  function endStroke() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  return (
    // m-auto (not justify-center) so the box stays centred in its scroll parent
    // without the overflowing edge being clipped when zoomed past the viewport.
    <div
      className="relative m-auto flex-shrink-0 rounded-xl overflow-hidden ring-1 ring-black/[0.12]"
      style={{
        width: dims ? dims.w * zoom : "100%",
        height: dims ? dims.h * zoom : 240,
        backgroundImage:
          "linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0,0 11px,11px -11px,-11px 0",
      }}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full cursor-crosshair"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawingRef.current = true;
          lastRef.current = null;
          stroke(e);
        }}
        onPointerMove={stroke}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <span className="w-6 h-6 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
});

const label = "text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.14em]";
const chipOff =
  "bg-black/[0.035] border-transparent text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-800";
const chipOn = "bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-500/25";
const floatCard =
  "bg-white rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_rgba(0,0,0,0.06)]";

function ModelSwitcher({
  value,
  onChange,
  models = MODELS,
  title = "Model",
  compact = false,
}: {
  value: ModelId;
  onChange: (id: ModelId) => void;
  models?: ModelConfig[];
  title?: string;
  compact?: boolean;
}) {
  if (compact) {
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

  return (
    <div className="flex flex-col gap-2">
      <label className={label}>{title}</label>
      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <button key={m.id} onClick={() => onChange(m.id)}
            className={`text-left rounded-2xl px-3 py-2.5 transition-all duration-200 ${
              value === m.id
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/20"
                : "bg-black/[0.03] text-zinc-700 hover:bg-black/[0.06]"
            }`}>
            <p className="text-xs font-bold leading-tight">{m.name}</p>
            <p className={`text-xs mt-0.5 leading-tight ${value === m.id ? "text-white/80" : "text-zinc-500"}`}>
              {m.provider} — {m.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

const selectBox =
  "w-full appearance-none text-xs font-semibold text-zinc-800 bg-black/[0.035] rounded-xl pl-3 pr-7 py-2 cursor-pointer transition-colors hover:bg-black/[0.06] focus:outline-none focus:ring-2 focus:ring-orange-400/30";

function Chevron() {
  return (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-[9px]">
      ▼
    </span>
  );
}

// Space-efficient stand-in for ModelSwitcher — one row instead of one card per model.
function ModelDropdown({
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

function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="21" y1="4" x2="14" y2="4" /><line x1="10" y1="4" x2="3" y2="4" />
      <line x1="21" y1="12" x2="12" y2="12" /><line x1="8" y1="12" x2="3" y2="12" />
      <line x1="21" y1="20" x2="16" y2="20" /><line x1="12" y1="20" x2="3" y2="20" />
      <line x1="14" y1="2" x2="14" y2="6" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="16" y1="18" x2="16" y2="22" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function GridSizeSlider({ columns, onChange }: { columns: number; onChange: (n: number) => void }) {
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

function SelectToolbar({
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

// Everything that floats over a thumbnail shares one neutral treatment — the
// badges aren't colour-coded by model any more.
const overlayChip =
  "bg-white/15 hover:bg-white/30 backdrop-blur-sm text-white transition-colors";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatDate(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ImageCard({
  img, index, onOpen, onEdit, onScene, onRemove, onViewOriginal, isBroken, onBroken, showDate,
  selectMode = false, selected = false, onToggleSelect,
}: {
  img: GeneratedImage;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onScene: () => void;
  onRemove: () => void;
  onViewOriginal: () => void;
  isBroken: boolean;
  onBroken: () => void;
  showDate?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const modelName = MODELS.find((m) => m.id === img.model)?.name ?? img.model.split("/")[1];
  return (
    <div className="break-inside-avoid animate-fade-up" style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}>
      <div
        className={`group relative rounded-2xl overflow-hidden bg-white cursor-pointer transition-opacity duration-150 ${
          isBroken ? "" : "card-glow"
        } ${selectMode && !selected ? "opacity-60" : ""} ${selected ? "ring-2 ring-orange-400" : ""}`}
        onClick={() => {
          if (selectMode) { onToggleSelect?.(); return; }
          if (!isBroken) onOpen();
        }}
      >
        {selectMode && (
          <div className={`absolute top-2 right-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-orange-500 border-orange-500" : "bg-white/70 border-white backdrop-blur-sm"
          }`}>
            {selected && <span className="text-white text-[10px] leading-none">✓</span>}
          </div>
        )}
        {isBroken ? (
          <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4">
            <span className="text-3xl opacity-30">🖼️</span>
            <p className="text-xs text-zinc-500 font-medium">Expired</p>
            {!selectMode && (
              <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="text-xs bg-red-500/15 hover:bg-red-500/30 text-red-400 px-3 py-1 rounded-full transition-colors font-medium mt-1">
                Remove
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-hidden">
              <Image src={img.url} alt={img.prompt} width={512} height={512}
                className="w-full h-auto object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                unoptimized onError={onBroken} priority={index === 0} />
            </div>
            {/* Hover overlay */}
            {!selectMode && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
                <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                  {img.prompt}
                </p>
                <div className="flex gap-1.5 flex-wrap translate-y-2 group-hover:translate-y-0 transition-transform duration-300 delay-[40ms]">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                    ✏️ Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onScene(); }}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                    🖼️ Scene
                  </button>
                  {img.uploadUrl && (
                    <button onClick={(e) => { e.stopPropagation(); onViewOriginal(); }}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold ${overlayChip}`}>
                      🐾 Original
                    </button>
                  )}
                  <a href={img.url} download onClick={(e) => e.stopPropagation()}
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${overlayChip}`}>
                    ↓
                  </a>
                </div>
              </div>
            )}
            {/* Badges */}
            <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
              {img.sourceUrl && !selectMode && (
                <span className="text-[10px] bg-black/45 backdrop-blur-sm text-white/85 px-2 py-0.5 rounded-full font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  Edited
                </span>
              )}
              {!selectMode && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto backdrop-blur-sm bg-black/45 text-white/85 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {modelName}
                </span>
              )}
            </div>
            {showDate && formatDate(img.createdAt) && (
              <div className="absolute bottom-2 right-2 pointer-events-none">
                <span className="text-[10px] bg-black/50 backdrop-blur-sm text-white/80 px-2 py-0.5 rounded-full font-medium">
                  {formatDate(img.createdAt)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoZoom, setPhotoZoom] = useState(1);
  const [backgroundPhoto, setBackgroundPhoto] = useState<File | null>(null);
  const [backgroundPhotoPreview, setBackgroundPhotoPreview] = useState<string | null>(null);
  const [bgSourceTab, setBgSourceTab] = useState<"upload" | "premade">(
    PREMADE_BACKGROUNDS.length > 0 ? "premade" : "upload"
  );
  const [selectedPremadeBg, setSelectedPremadeBg] = useState<string | null>(null);
  const [bgAspect, setBgAspect] = useState<number | null>(null);
  const [petPos, setPetPos] = useState({ x: 50, y: 65 });
  const [petScale, setPetScale] = useState(35);
  // Natural width/height of the pet image — needed to work out the box's height
  // so corner-dragging can scale it without distorting the pet.
  const [petAspect, setPetAspect] = useState(1);
  const draggingPetRef = useRef(false);
  const resizeRef = useRef<{ sx: number; sy: number; ax: number; ay: number; ratio: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [composeTarget, setComposeTarget] = useState<GeneratedImage | null>(null);
  const [composeModel, setComposeModel] = useState<ModelId>(DEFAULT_COMPOSE_MODEL);
  const [composeAspectRatio, setComposeAspectRatio] = useState("auto");
  const [composeResolution, setComposeResolution] = useState("2K");
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [removingBg, setRemovingBg] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineTool, setRefineTool] = useState<"erase" | "restore">("erase");
  const [refineBrush, setRefineBrush] = useState(40);
  const [savingRefine, setSavingRefine] = useState(false);
  const [refineZoom, setRefineZoom] = useState(1);
  const [refineDims, setRefineDims] = useState<{ w: number; h: number } | null>(null);
  const refineViewRef = useRef<HTMLDivElement>(null);
  const refinerRef = useRef<CutoutRefinerHandle>(null);
  // Set once the pet has been cut out — holds the original so it can be restored.
  const [petOriginalUrl, setPetOriginalUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "history">("generate");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<ModelId | null>(null);
  const [galleryColumns, setGalleryColumns] = useState(4);
  const [prompt, setPrompt] = useState("");
  const [showGenSettings, setShowGenSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numOutputs, setNumOutputs] = useState(1);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [resolution, setResolution] = useState("2K");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [brushTool, setBrushTool] = useState<"brush" | "eraser">("brush");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const inpaintCanvasRef = useRef<InpaintCanvasHandle>(null);
  const historyInitialSaveSkipped = useRef(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem("petpho-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {}

    // Sync with blob storage so history follows the account, not the browser:
    // pick up images generated elsewhere, and drop local entries for images
    // that were deleted elsewhere (otherwise they'd linger here as "Expired").
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { images?: { url: string; createdAt: number }[] } | null) => {
        if (!data) return;
        const liveBlobUrls = new Set((data.images ?? []).map((img) => img.url));
        setHistory((prev) => {
          const pruned = prev.filter(
            (x) => !x.url.includes(".public.blob.vercel-storage.com/") || liveBlobUrls.has(x.url)
          );
          const known = new Set(pruned.map((x) => x.url));
          const recovered = (data.images ?? [])
            .filter((img) => !known.has(img.url))
            .map((img) => ({
              url: img.url,
              prompt: "",
              model: "" as ModelId,
              createdAt: img.createdAt,
            }));
          if (pruned.length === prev.length && !recovered.length) return prev;
          return [...pruned, ...recovered].sort(
            (a, b) => (b.createdAt ?? Infinity) - (a.createdAt ?? Infinity)
          );
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!historyInitialSaveSkipped.current) {
      historyInitialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem("petpho-history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setLightbox(null); return; }
      if (e.key === "ArrowLeft") navigateLightbox(-1);
      else if (e.key === "ArrowRight") navigateLightbox(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, history]);

  async function handleApplyInpaint() {
    if (!editor || !editor.editPrompt.trim()) return;
    const maskDataUrl = inpaintCanvasRef.current?.getMaskDataUrl();
    if (!maskDataUrl) return;
    setEditor((e) => e && { ...e, loading: true, error: null });
    try {
      const res = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: editor.sourceImage.url, maskDataUrl, prompt: editor.editPrompt,
          aspectRatio: editor.aspectRatio === "original" ? undefined : editor.aspectRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inpaint failed");
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: editor.editPrompt, model: "black-forest-labs/flux-fill-pro" as ModelId, sourceUrl: editor.sourceImage.url,
      }));
      setHistory((prev) => [...newImages, ...prev]);
      setEditor((e) => e && { ...e, results: [...newImages, ...e.results], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setEditor((e) => e && { ...e, error: msg, loading: false });
    }
  }

  function toggleDictation(onText: (text: string) => void, onUnsupported: () => void) {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    type Recognition = {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      onUnsupported();
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results, (r) => r[0].transcript).join(" ").trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    setError(null);
    setPhotoZoom(1);
    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1024;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) return;
        const compressed = new File([blob], file.name, { type: "image/jpeg" });
        setPhoto(compressed);
        setPhotoPreview(URL.createObjectURL(compressed));
      }, "image/jpeg", 0.85);
    };
    img.src = objectUrl;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function selectPremadeBackground(bg: { id: string; file: string }) {
    const res = await fetch(bg.file);
    const blob = await res.blob();
    const file = new File([blob], `${bg.id}.jpg`, { type: blob.type || "image/jpeg" });
    setBackgroundPhoto(file);
    setBackgroundPhotoPreview(bg.file);
    setSelectedPremadeBg(bg.id);
    setBgAspect(null);
    setPetPos({ x: 50, y: 65 });
    setPetScale(35);
  }

  async function handleGenerate() {
    if (!photo) return;
    setLoading(true);
    setError(null);
    try {
      const zoomedPhoto = await new Promise<File>((resolve) => {
        const img = document.createElement("img");
        img.onload = () => {
          const [arW, arH] = (aspectRatio || "1:1").split(":").map(Number);
          const TARGET = 1024;
          const arScale = Math.min(TARGET / arW, TARGET / arH);
          const canvasW = Math.round(arW * arScale);
          const canvasH = Math.round(arH * arScale);
          const canvas = document.createElement("canvas");
          canvas.width = canvasW; canvas.height = canvasH;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvasW, canvasH);
          const maxDogW = canvasW * photoZoom;
          const maxDogH = canvasH * photoZoom;
          const dogScale = Math.min(maxDogW / img.naturalWidth, maxDogH / img.naturalHeight);
          const sw = img.naturalWidth * dogScale;
          const sh = img.naturalHeight * dogScale;
          ctx.drawImage(img, (canvasW - sw) / 2, (canvasH - sh) / 2, sw, sh);
          canvas.toBlob((blob) => {
            if (blob) resolve(new File([blob], photo!.name, { type: "image/jpeg" }));
          }, "image/jpeg", 0.85);
        };
        img.src = URL.createObjectURL(photo);
      });

      const formData = new FormData();
      formData.append("photo", zoomedPhoto);
      formData.append("prompt", prompt.trim());
      formData.append("aspectRatio", aspectRatio);
      formData.append("numOutputs", String(numOutputs));
      formData.append("model", model);
      formData.append("resolution", resolution);

      const res = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      const now = Date.now();
      const uploadUrl = data.uploadUrl as string | undefined;
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: prompt || "Pixar style", model, createdAt: now, uploadUrl,
      }));
      setHistory((prev) => [...newImages, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function openEditor(img: GeneratedImage) {
    setEditor({
      sourceImage: img, editPrompt: "", aspectRatio: "original",
      loading: false, error: null, results: [],
    });
  }

  function openCompose(img: GeneratedImage) {
    setComposeTarget(img);
    setPetOriginalUrl(null);
    setRefining(false);
    setComposeError(null);
  }

  // Cutting the pet out first stops its original background from bleeding into
  // the new scene and fighting the background the user picked.
  async function handleRemoveBackground() {
    if (!composeTarget) return;
    setRemovingBg(true);
    setComposeError(null);
    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: composeTarget.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Background removal failed");
      setPetOriginalUrl(composeTarget.url);
      setComposeTarget({ ...composeTarget, url: data.url });
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Background removal failed");
    } finally {
      setRemovingBg(false);
    }
  }

  // Zoom that makes the whole cutout fit inside the touch-up viewport, so it
  // opens showing the entire pet instead of a crop of its top edge.
  function fitRefineZoom(dims: { w: number; h: number } | null) {
    const el = refineViewRef.current;
    if (!el || !dims) return 1;
    const pad = 32;
    return clamp(
      Math.min((el.clientWidth - pad) / dims.w, (el.clientHeight - pad) / dims.h),
      0.05,
      8
    );
  }

  function zoomRefine(factor: number) {
    setRefineZoom((z) => clamp(z * factor, 0.05, 8));
  }

  // Ctrl/⌘ + wheel to zoom. Registered natively because React's wheel listener
  // is passive, so preventDefault there wouldn't stop the browser zooming.
  useEffect(() => {
    const el = refineViewRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setRefineZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 0.89), 0.05, 8));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [refining]);

  async function applyRefinedCutout() {
    if (!composeTarget) return;
    const blob = await refinerRef.current?.toBlob();
    if (!blob) return;
    setSavingRefine(true);
    setComposeError(null);
    try {
      const fd = new FormData();
      fd.append("image", blob, "cutout.png");
      const res = await fetch("/api/upload-cutout", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your touch-ups");
      setComposeTarget({ ...composeTarget, url: data.url });
      setRefining(false);
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Could not save your touch-ups");
    } finally {
      setSavingRefine(false);
    }
  }

  function restoreBackground() {
    if (!composeTarget || !petOriginalUrl) return;
    setComposeTarget({ ...composeTarget, url: petOriginalUrl });
    setPetOriginalUrl(null);
    setRefining(false);
  }

  // Height of the pet box as a % of stage height. The box is sized by width
  // (petScale), so height follows from the image's own aspect ratio.
  function petBoxHeightPct(rect: DOMRect) {
    const widthPx = (petScale / 100) * rect.width;
    return ((widthPx / petAspect) / rect.height) * 100;
  }

  // Corner drag: the opposite corner stays pinned and the box scales uniformly.
  function startPetResize(e: React.PointerEvent, sx: number, sy: number) {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const hPct = petBoxHeightPct(rect);
    resizeRef.current = {
      sx,
      sy,
      ax: petPos.x - (sx * petScale) / 2,
      ay: petPos.y - (sy * hPct) / 2,
      ratio: hPct / petScale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPetResize(e: React.PointerEvent) {
    const r = resizeRef.current;
    const stage = stageRef.current;
    if (!r || !stage) return;
    const rect = stage.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const newW = clamp(Math.abs(px - r.ax), 5, 100);
    const newH = newW * r.ratio;
    setPetScale(Math.round(newW));
    setPetPos({
      x: clamp(r.ax + (r.sx * newW) / 2, 0, 100),
      y: clamp(r.ay + (r.sy * newH) / 2, 0, 100),
    });
  }

  function endPetResize() {
    resizeRef.current = null;
  }

  async function handleCompose() {
    if (!composeTarget || !backgroundPhoto) return;
    setComposeLoading(true);
    setComposeError(null);
    try {
      const fd = new FormData();
      fd.append("sourceImageUrl", composeTarget.url);
      fd.append("backgroundPhoto", backgroundPhoto);
      fd.append("model", composeModel);
      fd.append("aspectRatio", composeAspectRatio);
      fd.append("resolution", composeResolution);
      fd.append("petX", String(petPos.x));
      fd.append("petY", String(petPos.y));
      fd.append("petScale", String(petScale));
      const res = await fetch("/api/compose", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Compose failed");
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: composeTarget.prompt + " (placed in scene)",
        model: composeModel, sourceUrl: composeTarget.url,
      }));
      setHistory((h) => [...newImages, ...h]);
      setComposeTarget(null);
      setPetOriginalUrl(null);
      setRefining(false);
      setBackgroundPhoto(null);
      setBackgroundPhotoPreview(null);
      setSelectedPremadeBg(null);
      setBgAspect(null);
      setPetPos({ x: 50, y: 65 });
      setPetScale(35);
      setComposeAspectRatio("auto");
      setComposeResolution("2K");
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setComposeLoading(false);
    }
  }

  const filteredHistory = history.filter((img) => {
    const matchSearch = !historySearch || img.prompt.toLowerCase().includes(historySearch.toLowerCase());
    const matchFilter = !historyFilter || img.model === historyFilter;
    return matchSearch && matchFilter;
  });

  const lightboxIndex = lightbox ? history.findIndex((img) => img.url === lightbox) : -1;

  function navigateLightbox(delta: number) {
    if (lightboxIndex === -1) return;
    const next = lightboxIndex + delta;
    if (next >= 0 && next < history.length) setLightbox(history[next].url);
  }

  const previewAspect =
    composeAspectRatio !== "auto" ? aspectRatioToNumber(composeAspectRatio) : bgAspect ?? 16 / 9;

  const sidebarActive = composeTarget || editor ? "history" : activeTab;

  function navTo(tab: "generate" | "history") {
    setEditor(null);
    setComposeTarget(null);
    setPetOriginalUrl(null);
    setRefining(false);
    setBackgroundPhoto(null);
    setBackgroundPhotoPreview(null);
    setComposeError(null);
    setSelectMode(false);
    setSelectedUrls(new Set());
    setActiveTab(tab);
    // Edit drops you straight into the editor on the newest photo — the grid is
    // still one click away via "All photos".
    if (tab === "history" && history.length > 0) openEditor(history[0]);
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
    window.location.href = "/login";
  }

  function markBroken(url: string) {
    setBrokenImages((prev) => new Set(prev).add(url));
  }

  function removeFromHistory(url: string) {
    setHistory((h) => h.filter((x) => x.url !== url));
    fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
  }

  function toggleSelected(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function selectAllVisible(list: GeneratedImage[]) {
    setSelectedUrls(new Set(list.map((img) => img.url)));
  }

  function bulkDeleteSelected() {
    if (selectedUrls.size === 0) return;
    if (!confirm(`Delete ${selectedUrls.size} image${selectedUrls.size !== 1 ? "s" : ""}? This can't be undone.`)) return;
    const urls = Array.from(selectedUrls);
    setHistory((h) => h.filter((x) => !selectedUrls.has(x.url)));
    urls.forEach((url) => {
      fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    });
    setSelectedUrls(new Set());
    setSelectMode(false);
  }

  const errorBox = "text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 animate-fade-in";

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f6f7] text-zinc-800">

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <nav className="w-[212px] flex-shrink-0 flex flex-col bg-white">
        <div className="px-4 pt-6 pb-5 flex items-center gap-2.5 group/brand">
          <Image src="/logo.png" alt="Petpho mascot" width={40} height={40}
            className="w-10 h-10 flex-shrink-0 transition-transform duration-300 group-hover/brand:scale-110 group-hover/brand:-rotate-6" />
          <div className="min-w-0">
            <p className="text-zinc-900 font-bold text-sm tracking-tight leading-tight">Petpho</p>
            <p className="text-orange-400 text-[11px] font-semibold leading-tight">Gen</p>
          </div>
        </div>

        <div className="px-3 flex flex-col gap-0.5">
          {([
            { id: "generate" as const, icon: "✨", name: "Create" },
            { id: "history" as const, icon: "🎨", name: "Edit" },
          ]).map((item) => {
            const active = sidebarActive === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navTo(item.id)}
                className={`group flex items-center gap-3 px-3 py-2 rounded-xl w-full text-left transition-all duration-200 ${
                  active
                    ? "bg-black/[0.055] text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.03]"
                }`}
              >
                <span className="text-[15px] leading-none transition-transform duration-200 group-hover:scale-110">
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium flex-1">{item.name}</span>
                {item.id === "history" && history.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-colors duration-200 ${
                    active ? "bg-orange-400/15 text-orange-500" : "bg-black/[0.05] text-zinc-500"
                  }`}>
                    {history.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <div className="px-3 pb-2">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 rounded-xl w-full text-left text-zinc-500 hover:text-red-500 hover:bg-red-500/[0.06] transition-all duration-200"
          >
            <span className="text-[15px] leading-none">🚪</span>
            <span className="text-[13px] font-medium">Sign out</span>
          </button>
        </div>

        <div className="px-4 py-3.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-[0.14em]">Admin</span>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* COMPOSE VIEW */}
        {composeTarget && (
          <div className="flex-1 flex overflow-hidden animate-fade-in">
            <aside className={`w-[264px] ${floatCard} flex flex-col gap-4 p-4 overflow-y-auto flex-shrink-0 m-6 mr-3`}>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => { setComposeTarget(null); setPetOriginalUrl(null); setRefining(false); setBackgroundPhoto(null); setBackgroundPhotoPreview(null); setSelectedPremadeBg(null); setBgAspect(null); setComposeError(null); }}
                  className="w-7 h-7 rounded-full bg-black/[0.04] hover:bg-black/[0.1] text-zinc-600 hover:text-zinc-900 transition-all flex items-center justify-center text-sm flex-shrink-0"
                >
                  ←
                </button>
                <span className="font-bold text-zinc-900 text-sm">Place in Scene</span>
              </div>

              {/* Pet — thumbnail sits inline with its actions to save height */}
              <div className="flex gap-2.5 flex-shrink-0">
                <div
                  className="w-16 h-16 rounded-xl overflow-hidden ring-1 ring-black/[0.08] flex-shrink-0"
                  style={petOriginalUrl ? {
                    backgroundImage:
                      "linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)",
                    backgroundSize: "12px 12px",
                    backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
                  } : undefined}
                >
                  <img src={composeTarget.url} alt="Pixar pet"
                    className={`w-full h-full ${petOriginalUrl ? "object-contain" : "object-cover"}`} />
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0 justify-center">
                  {petOriginalUrl ? (
                    <>
                      <button onClick={() => setRefining(true)}
                        className="w-full py-1.5 rounded-full text-xs font-bold border border-transparent bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 transition-all duration-200">
                        ✏️ Touch up
                      </button>
                      <button onClick={restoreBackground} title="Put the original background back"
                        className={`w-full py-1.5 rounded-full text-xs font-bold border transition-all duration-200 ${chipOff}`}>
                        ↩ Restore
                      </button>
                    </>
                  ) : (
                    <button onClick={handleRemoveBackground} disabled={removingBg}
                      title="Cut the pet out so its old background doesn't clash with the new scene"
                      className="w-full py-2 rounded-full text-xs font-bold border border-transparent bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2">
                      {removingBg
                        ? (<><span className="w-3 h-3 border-2 border-orange-500/40 border-t-orange-500 rounded-full animate-spin" />Removing…</>)
                        : <>✂️ Remove background</>}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <label className={`${label} whitespace-nowrap`}>Background</label>
                  <div className="flex rounded-full bg-black/[0.035] p-0.5 text-[11px] font-semibold flex-shrink-0">
                    <button onClick={() => setBgSourceTab("premade")}
                      className={`px-2.5 py-1 rounded-md transition-all duration-200 ${
                        bgSourceTab === "premade" ? "bg-sky-500 text-white" : "text-zinc-500 hover:text-zinc-700"
                      }`}>
                      Premade
                    </button>
                    <button onClick={() => setBgSourceTab("upload")}
                      className={`px-2.5 py-1 rounded-md transition-all duration-200 ${
                        bgSourceTab === "upload" ? "bg-sky-500 text-white" : "text-zinc-500 hover:text-zinc-700"
                      }`}>
                      Upload
                    </button>
                  </div>
                </div>

                {bgSourceTab === "premade" ? (
                  PREMADE_BACKGROUNDS.length > 0 ? (
                    // Scrolls on its own so the ratio/model controls below stay
                    // put. The cap lives on the wrapper, not the grid, or the
                    // rows get squashed instead of overflowing.
                    <div className="max-h-[264px] overflow-y-auto pr-0.5">
                    <div className="grid grid-cols-3 gap-2">
                      {PREMADE_BACKGROUNDS.map((bg) => (
                        <button key={bg.id} onClick={() => selectPremadeBackground(bg)}
                          title={bg.name}
                          className={`relative rounded-lg overflow-hidden aspect-square ring-2 transition-all duration-200 ${
                            selectedPremadeBg === bg.id ? "ring-orange-400" : "ring-black/[0.08] hover:ring-black/[0.3]"
                          }`}>
                          <img src={bg.file} alt={bg.name} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed border-black/[0.1] bg-black/[0.02] py-6 px-3 text-center">
                      <p className="text-xs text-zinc-500">No premade backgrounds yet</p>
                      <p className="text-[11px] text-zinc-600 mt-1">Add photos to public/backgrounds</p>
                    </div>
                  )
                ) : backgroundPhotoPreview && !selectedPremadeBg ? (
                  <div className="relative rounded-xl overflow-hidden ring-2 ring-sky-400/50 animate-scale-in">
                    <img src={backgroundPhotoPreview} alt="Background" className="w-full h-24 object-cover" />
                    <button
                      onClick={() => bgFileInputRef.current?.click()}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg transition-colors"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => bgFileInputRef.current?.click()}
                    className="cursor-pointer flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-400/25 bg-sky-400/[0.04] hover:border-sky-400/60 hover:bg-sky-400/[0.1] py-8 transition-all duration-200"
                  >
                    <span className="text-3xl">🖼️</span>
                    <p className="text-sm font-medium text-zinc-700">Upload a background</p>
                    <p className="text-xs text-zinc-600">Drag your pet into place after</p>
                  </div>
                )}
                <input ref={bgFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBackgroundPhoto(file);
                    setBackgroundPhotoPreview(URL.createObjectURL(file));
                    setSelectedPremadeBg(null);
                    setBgAspect(null);
                    setPetPos({ x: 50, y: 65 });
                    setPetScale(35);
                    e.target.value = "";
                  }} />
              </div>

              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <label className={label}>Output Ratio</label>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setComposeAspectRatio("auto")}
                    title="Match your background photo's shape"
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all duration-200 ${
                      composeAspectRatio === "auto" ? chipOn : chipOff
                    }`}>
                    Auto
                  </button>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r.value} onClick={() => setComposeAspectRatio(r.value)}
                      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all duration-200 ${
                        composeAspectRatio === r.value ? chipOn : chipOff
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 items-end flex-shrink-0">
                <ModelDropdown
                  value={composeModel}
                  models={COMPOSE_MODELS}
                  title="Model"
                  onChange={(id) => {
                    setComposeModel(id);
                    // Keep the resolution on something this model actually offers.
                    const opts = getComposeModelConfig(id).supportedResolutions;
                    if (opts && !opts.includes(composeResolution)) setComposeResolution(opts[0]);
                  }}
                />
                {(() => {
                  const options = getComposeModelConfig(composeModel).supportedResolutions;
                  if (!options) return null;
                  return (
                    <div className="flex flex-col gap-1.5 w-[72px] flex-shrink-0">
                      <label className={label}>Res</label>
                      <div className="relative">
                        <select
                          value={options.includes(composeResolution) ? composeResolution : options[0]}
                          onChange={(e) => setComposeResolution(e.target.value)}
                          className={selectBox}
                        >
                          {options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <Chevron />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {composeError && <p className={errorBox}>{composeError}</p>}

              <button
                onClick={handleCompose}
                disabled={composeLoading || !backgroundPhoto}
                className="w-full py-2.5 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg shadow-sky-500/25 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-white flex items-center justify-center gap-2 flex-shrink-0"
              >
                {composeLoading
                  ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Composing...</>)
                  : <>🖼️ Place in Scene</>}
              </button>
            </aside>

            <section className="flex-1 p-6 overflow-y-auto flex items-center justify-center">
              {composeLoading ? (
                <div className="flex flex-col items-center gap-5 animate-fade-in">
                  <div className="relative">
                    <span className="block w-14 h-14 border-4 border-sky-500/20 border-t-sky-400 rounded-full animate-spin" />
                    <span className="absolute inset-0 rounded-full animate-glow-pulse" style={{ boxShadow: "0 0 30px rgba(56,189,248,0.3)" }} />
                  </div>
                  <p className="text-sm text-zinc-600">Placing your pet in the scene...</p>
                </div>
              ) : removingBg ? (
                <div className="flex flex-col items-center gap-5 animate-fade-in">
                  <div className="relative">
                    <span className="block w-14 h-14 border-4 border-orange-500/20 border-t-orange-400 rounded-full animate-spin" />
                    <span className="absolute inset-0 rounded-full animate-glow-pulse" />
                  </div>
                  <p className="text-sm text-zinc-600">Removing the background...</p>
                </div>
              ) : backgroundPhotoPreview ? (
                <div className="flex flex-col items-center gap-3 animate-scale-in w-full">
                  <div
                    ref={stageRef}
                    className="relative rounded-2xl overflow-hidden ring-1 ring-black/[0.1] shadow-2xl shadow-black/50 select-none bg-black/20"
                    style={{ aspectRatio: `${previewAspect}`, width: "100%", maxWidth: 640 }}
                  >
                    <img
                      src={backgroundPhotoPreview}
                      alt="Background"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setBgAspect(img.naturalWidth / img.naturalHeight);
                      }}
                    />
                    <div
                      className="absolute ring-2 ring-orange-400/70 rounded-lg"
                      style={{
                        left: `${petPos.x}%`,
                        top: `${petPos.y}%`,
                        width: `${petScale}%`,
                        transform: "translate(-50%, -50%)",
                        touchAction: "none",
                      }}
                    >
                      <img
                        src={composeTarget.url}
                        alt="Pixar pet"
                        draggable={false}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          if (img.naturalHeight) setPetAspect(img.naturalWidth / img.naturalHeight);
                        }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          draggingPetRef.current = true;
                        }}
                        onPointerMove={(e) => {
                          if (!draggingPetRef.current || !stageRef.current) return;
                          const rect = stageRef.current.getBoundingClientRect();
                          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
                          const yPct = ((e.clientY - rect.top) / rect.height) * 100;
                          setPetPos({
                            x: clamp(xPct, 0, 100),
                            y: clamp(yPct, 0, 100),
                          });
                        }}
                        onPointerUp={() => { draggingPetRef.current = false; }}
                        className="w-full h-auto block cursor-grab active:cursor-grabbing drop-shadow-2xl rounded-lg"
                        style={{ touchAction: "none" }}
                      />

                      {/* Corner handles — drag to scale, opposite corner stays put */}
                      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => (
                        <span
                          key={`${sx}:${sy}`}
                          onPointerDown={(e) => startPetResize(e, sx, sy)}
                          onPointerMove={onPetResize}
                          onPointerUp={endPetResize}
                          onPointerCancel={endPetResize}
                          className="absolute w-3 h-3 bg-white border-2 border-orange-400 rounded-[3px] shadow-sm hover:scale-125 transition-transform"
                          style={{
                            left: sx < 0 ? 0 : "100%",
                            top: sy < 0 ? 0 : "100%",
                            transform: "translate(-50%, -50%)",
                            cursor: sx * sy > 0 ? "nwse-resize" : "nesw-resize",
                            touchAction: "none",
                          }}
                        />
                      ))}

                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-orange-500 text-white px-2 py-0.5 rounded-full pointer-events-none whitespace-nowrap">
                        {petScale}%
                      </span>
                    </div>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] bg-black/60 backdrop-blur-sm text-white/80 px-3 py-1 rounded-full font-medium pointer-events-none">
                      Drag to move · pull a corner to resize
                    </div>
                  </div>
                </div>
              ) : petOriginalUrl ? (
                <div className="flex flex-col items-center gap-4 animate-scale-in w-full">
                  <div
                    className="rounded-2xl overflow-hidden ring-1 ring-black/[0.1] w-full"
                    style={{
                      maxWidth: 460,
                      backgroundImage:
                        "linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)",
                      backgroundSize: "22px 22px",
                      backgroundPosition: "0 0,0 11px,11px -11px,-11px 0",
                    }}
                  >
                    <img src={composeTarget.url} alt="Pet cutout" className="w-full h-auto" />
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm font-medium text-zinc-600">Background removed</p>
                    <div className="flex gap-2">
                      <button onClick={() => setRefining(true)}
                        className="text-xs px-3 py-1.5 rounded-full font-semibold bg-orange-500 text-white hover:bg-orange-400 transition-all duration-200">
                        ✏️ Touch up
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500">Now pick a background photo on the left</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-zinc-600">
                  <span className="text-5xl animate-float">🖼️</span>
                  <p className="text-sm font-medium text-zinc-500">Upload a background photo to get started</p>
                </div>
              )}
            </section>
          </div>
        )}

        {/* EDITOR VIEW */}
        {!composeTarget && editor && (
          <div className="flex-1 flex overflow-hidden animate-fade-in">

            {/* Left panel: photo picker + results */}
            <div className={`flex flex-col w-[236px] ${floatCard} p-4 gap-4 overflow-hidden flex-shrink-0 my-6 ml-6`}>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <span className="font-bold text-zinc-900 text-sm flex-1">Editor</span>
                <button onClick={() => setEditor(null)} title="Browse all photos in a grid"
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-black/[0.035] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.07] transition-all">
                  All photos
                </button>
              </div>

              {/* Switch which photo you're editing without leaving the canvas */}
              <div className="flex flex-col gap-2 flex-shrink-0">
                <label className={label}>Photos — {history.length}</label>
                <div className="max-h-[32vh] overflow-y-auto pr-0.5">
                <div className="grid grid-cols-2 gap-2">
                  {history.map((img, i) => {
                    const active = img.url === editor.sourceImage.url;
                    return (
                      <button key={`pick-${img.url}-${i}`}
                        onClick={() => { if (!active) openEditor(img); }}
                        title={img.prompt || "Untitled"}
                        className={`relative rounded-lg overflow-hidden aspect-square bg-black/[0.04] ring-2 transition-all duration-150 ${
                          active
                            ? "ring-orange-400"
                            : "ring-transparent opacity-70 hover:opacity-100 hover:ring-black/15"
                        }`}>
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    );
                  })}
                </div>
                </div>
                {editor.sourceImage.prompt && (
                  <p className="text-xs text-zinc-500 italic line-clamp-2">&ldquo;{editor.sourceImage.prompt}&rdquo;</p>
                )}
              </div>

              <div className="border-t border-black/[0.05] pt-4 flex flex-col gap-2 flex-1 min-h-0">
                <label className={`${label} flex-shrink-0`}>Results{editor.results.length > 0 ? ` — ${editor.results.length}` : ""}</label>
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-0.5">
                  {editor.loading && <div className="rounded-2xl skeleton w-full flex-shrink-0" style={{ aspectRatio: "1/1" }} />}
                  {editor.results.length === 0 && !editor.loading ? (
                    <p className="text-xs text-zinc-500 leading-relaxed">Brush over the image, describe the change, and results appear here</p>
                  ) : (
                    editor.results.map((img, i) => (
                      <div key={`${img.url}-${i}`}
                        className="group relative rounded-2xl overflow-hidden bg-white card-glow cursor-pointer animate-scale-in flex-shrink-0"
                        onClick={() => setLightbox(img.url)}>
                        <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105" unoptimized />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2.5 gap-1.5">
                          <div className="flex gap-1.5 flex-wrap">
                            <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${overlayChip}`}>Edit this</button>
                            <a href={img.url} download onClick={(e) => e.stopPropagation()} className={`text-[11px] px-2 py-0.5 rounded-full ${overlayChip}`}>↓</a>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Center: canvas + floating edit bar */}
            <div className="flex-1 relative overflow-hidden flex flex-col">
              <section className="flex-1 overflow-auto p-6 pb-36">
                <div className={`${floatCard} p-4 w-fit max-w-full mx-auto overflow-auto`}>
                  <div style={{ transform: `scale(${canvasZoom})`, transformOrigin: "top left", display: "inline-block" }}>
                    <InpaintCanvas key={editor.sourceImage.url} ref={inpaintCanvasRef} imageUrl={editor.sourceImage.url} brushSize={brushSize} tool={brushTool} />
                  </div>
                </div>
              </section>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(540px,calc(100%-3rem))] z-30 flex flex-col gap-3">
                {editor.error && (
                  <div className="flex justify-center"><div className={errorBox}>{editor.error}</div></div>
                )}
                <div className={`${floatCard} !rounded-[26px] p-2 pl-4 flex items-center gap-2`}>
                  <textarea value={editor.editPrompt}
                    onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleApplyInpaint(); } }}
                    placeholder="Describe what to put in the brushed area…"
                    rows={1}
                    className="flex-1 bg-transparent text-sm py-2.5 resize-none focus:outline-none placeholder-zinc-500 text-zinc-900" />
                  <button
                    type="button"
                    onClick={() => toggleDictation(
                      (t) => setEditor((ed) => ed && { ...ed, editPrompt: ed.editPrompt ? `${ed.editPrompt} ${t}` : t }),
                      () => setEditor((ed) => ed && { ...ed, error: "Voice input isn't supported in this browser — try Chrome" }),
                    )}
                    title={listening ? "Stop listening" : "Dictate your edit"}
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                      listening
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-black/[0.04] text-zinc-500 hover:text-zinc-800"
                    }`}>
                    <MicIcon />
                  </button>
                  <button onClick={handleApplyInpaint} disabled={editor.loading || !editor.editPrompt.trim()} title="Apply Inpaint"
                    className="btn-primary w-10 h-10 rounded-full font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center flex-shrink-0">
                    {editor.loading
                      ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      : <span className="text-base leading-none">🖌️</span>}
                  </button>
                </div>
              </div>
            </div>

            {/* Right panel: settings */}
            <div className={`flex flex-col w-[236px] ${floatCard} p-4 gap-5 overflow-y-auto flex-shrink-0 my-6 mr-6`}>
              <div className="flex flex-col gap-2">
                <label className={label}>Tool</label>
                <div className="flex gap-2">
                  <button onClick={() => setBrushTool("brush")}
                    className={`flex-1 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${brushTool === "brush" ? chipOn : chipOff}`}>
                    🖌️ Brush
                  </button>
                  <button onClick={() => setBrushTool("eraser")}
                    className={`flex-1 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${brushTool === "eraser" ? chipOn : chipOff}`}>
                    ⬜ Eraser
                  </button>
                </div>
                <button onClick={() => inpaintCanvasRef.current?.clear()}
                  className={`w-full py-2 rounded-full text-xs font-bold border transition-all duration-200 ${chipOff}`}>
                  Clear Mask
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>
                  Brush Size — <span className="text-orange-400">{brushSize}px</span>
                </label>
                <input type="range" min={5} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>
                  Zoom — <span className="text-orange-400">{Math.round(canvasZoom * 100)}%</span>
                </label>
                <input type="range" min={50} max={300} step={10} value={canvasZoom * 100} onChange={(e) => setCanvasZoom(Number(e.target.value) / 100)} className="w-full" />
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Output Size</label>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setEditor((ed) => ed && { ...ed, aspectRatio: "original" })}
                    className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                      editor.aspectRatio === "original" ? chipOn : chipOff
                    }`}>
                    Original
                  </button>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r.value} onClick={() => setEditor((ed) => ed && { ...ed, aspectRatio: r.value })}
                      className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                        editor.aspectRatio === r.value ? chipOn : chipOff
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                {editor.aspectRatio !== "original" && (
                  <p className="text-[11px] text-zinc-500 leading-snug">Canvas expands to {editor.aspectRatio} — the new area is AI-filled to match the scene</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CREATE TAB */}
        {!composeTarget && !editor && activeTab === "generate" && (
          <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden animate-fade-in relative">
                <section className="flex-1 overflow-y-auto px-6 pt-6 pb-44">
                  {history.length === 0 && !loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                      <div className="animate-float logo-glow">
                        <Image src="/logo.png" alt="Petpho mascot" width={160} height={160} className="w-36 h-36" priority />
                      </div>
                      <p className="text-base font-semibold text-zinc-700">Your Pixar pet portraits will appear here</p>
                      <p className="text-sm text-zinc-600">Upload a photo and hit Generate ✨</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-end items-center gap-2 mb-3">
                        <SelectToolbar
                          selectMode={selectMode}
                          selectedCount={selectedUrls.size}
                          onToggle={() => { setSelectMode((v) => !v); setSelectedUrls(new Set()); }}
                          onSelectAll={() => selectAllVisible(history)}
                          onDelete={bulkDeleteSelected}
                        />
                        <GridSizeSlider columns={galleryColumns} onChange={setGalleryColumns} />
                      </div>
                      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${galleryColumns}, minmax(0, 1fr))` }}>
                      {loading && Array.from({ length: numOutputs }).map((_, i) => (
                        <div key={`sk-${i}`} className="rounded-2xl skeleton" style={{ aspectRatio: aspectRatio.replace(":", "/") }} />
                      ))}
                      {history.map((img, i) => (
                        <ImageCard
                          key={`gen-${img.url}-${i}`}
                          img={img}
                          index={i}
                          isBroken={brokenImages.has(img.url)}
                          onBroken={() => markBroken(img.url)}
                          onOpen={() => setLightbox(img.url)}
                          onEdit={() => openEditor(img)}
                          onScene={() => openCompose(img)}
                          onRemove={() => removeFromHistory(img.url)}
                          onViewOriginal={() => img.uploadUrl && setLightbox(img.uploadUrl)}
                          selectMode={selectMode}
                          selected={selectedUrls.has(img.url)}
                          onToggleSelect={() => toggleSelected(img.url)}
                        />
                      ))}
                      </div>
                    </>
                  )}
                </section>

                {/* ── Floating prompt bar ── */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[min(700px,calc(100%-3rem))] z-30 flex flex-col gap-3">
                  {showGenSettings && (
                    <div className={`${floatCard} p-4 flex flex-col gap-4 animate-scale-in`}>
                      <ModelSwitcher value={model} onChange={setModel} compact />
                      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
                        <div className="flex flex-col gap-2">
                          <label className={label}>Aspect Ratio</label>
                          <div className="flex flex-wrap gap-1.5">
                            {ASPECT_RATIOS.map((r) => (
                              <button key={r.value} onClick={() => setAspectRatio(r.value)}
                                className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                                  aspectRatio === r.value ? chipOn : chipOff
                                }`}>
                                {r.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {(() => {
                          const options = getModelConfig(model).supportedResolutions;
                          if (!options) return null;
                          const idx = Math.max(0, options.indexOf(resolution));
                          return (
                            <div className="flex flex-col gap-2 w-28">
                              <label className={label}>
                                Resolution — <span className="text-orange-400">{options[idx]}</span>
                              </label>
                              <input type="range" min={0} max={options.length - 1} step={1} value={idx}
                                onChange={(e) => setResolution(options[Number(e.target.value)])}
                                className="w-full" />
                              <div className="flex justify-between text-[10px] text-zinc-500 px-0.5">
                                {options.map((o) => <span key={o}>{o}</span>)}
                              </div>
                            </div>
                          );
                        })()}
                        <div className="flex flex-col gap-2 w-28">
                          <label className={label}>
                            Images — <span className="text-orange-400">{numOutputs}</span>
                          </label>
                          <input type="range" min={1} max={4} value={numOutputs}
                            onChange={(e) => setNumOutputs(Number(e.target.value))}
                            className="w-full" />
                        </div>
                        {photoPreview && (
                          <div className="flex flex-col gap-2 w-28">
                            <label className={label}>
                              Scale — <span className="text-orange-400">{Math.round(photoZoom * 100)}%</span>
                            </label>
                            <input type="range" min={20} max={100} value={photoZoom * 100}
                              onChange={(e) => setPhotoZoom(Number(e.target.value) / 100)}
                              className="w-full" />
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400">⌘ + Enter to generate</p>
                    </div>
                  )}

                  {(!photo || error) && (
                    <div className="flex justify-center">
                      {error
                        ? <div className={errorBox}>{error}</div>
                        : <p className="text-xs text-zinc-500 bg-white/70 backdrop-blur-sm px-3 py-1 rounded-full">Upload a pet photo to get started</p>}
                    </div>
                  )}

                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    className={`${floatCard} !rounded-[26px] p-2 pl-2.5 flex items-center gap-2 transition-all duration-200 ${
                      dragging ? "ring-2 ring-orange-400/70 scale-[1.01]" : ""
                    }`}
                  >
                    {photoPreview ? (
                      <button onClick={() => fileInputRef.current?.click()} title="Change photo"
                        className="relative w-10 h-10 rounded-2xl overflow-hidden ring-2 ring-orange-400/50 flex-shrink-0 group/photo">
                        <img src={photoPreview} alt="Uploaded pet" className="w-full h-full object-cover" />
                        <span
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPhoto(null); setPhotoPreview(null); setPhotoZoom(1); }}
                          className="absolute inset-0 hidden group-hover/photo:flex items-center justify-center bg-black/55 text-white text-xs font-bold">
                          ✕
                        </span>
                      </button>
                    ) : (
                      <button onClick={() => fileInputRef.current?.click()} title="Upload pet photo — or drop it here"
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-xl font-light flex-shrink-0 transition-all duration-200 ${
                          dragging
                            ? "bg-orange-400/25 text-orange-500 scale-110"
                            : "bg-black/[0.04] text-zinc-500 hover:bg-black/[0.08] hover:text-zinc-800"
                        }`}>
                        +
                      </button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }} />

                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleGenerate(); } }}
                      placeholder={photo ? "Describe your Pixar scene… (optional)" : "Upload a pet photo, then describe the scene…"}
                      rows={1}
                      className="flex-1 bg-transparent text-sm px-2 py-2.5 resize-none focus:outline-none placeholder-zinc-500 text-zinc-900" />

                    <button
                      type="button"
                      onClick={() => setShowGenSettings((v) => !v)}
                      title="Model, aspect ratio & more"
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        showGenSettings
                          ? "bg-orange-500 text-white"
                          : "bg-black/[0.04] text-zinc-500 hover:text-zinc-800"
                      }`}>
                      <SlidersIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDictation(
                        (t) => setPrompt((p) => (p ? `${p} ${t}` : t)),
                        () => setError("Voice input isn't supported in this browser — try Chrome"),
                      )}
                      title={listening ? "Stop listening" : "Dictate your prompt"}
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        listening
                          ? "bg-red-500 text-white animate-pulse"
                          : "bg-black/[0.04] text-zinc-500 hover:text-zinc-800"
                      }`}>
                      <MicIcon />
                    </button>
                    <button onClick={handleGenerate} disabled={loading || !photo} title="Generate Pixar Art"
                      className="btn-primary w-10 h-10 rounded-full font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center flex-shrink-0">
                      {loading
                        ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        : <span className="text-base leading-none">✨</span>}
                    </button>
                  </div>
                </div>
              </div>
          </div>
        )}

        {/* EDIT TAB — pick a generated photo to open in the editor */}
        {!composeTarget && !editor && activeTab === "history" && (
          <section className="flex-1 overflow-y-auto p-8 animate-fade-in">
            <div className="flex items-start justify-between mb-6 gap-4">
              <div className="animate-slide-in-left">
                <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">All photos</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {history.length === 0 ? "Generate a photo first" : "Pick a photo to open it in the editor"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">🔍</span>
                  <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search prompts..."
                    className="pl-8 pr-4 py-2 text-sm bg-black/[0.035] border border-transparent rounded-full text-zinc-900 placeholder-zinc-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-400/20 w-52 transition-all duration-200" />
                </div>
                {history.length > 0 && (
                  <SelectToolbar
                    selectMode={selectMode}
                    selectedCount={selectedUrls.size}
                    onToggle={() => { setSelectMode((v) => !v); setSelectedUrls(new Set()); }}
                    onSelectAll={() => selectAllVisible(filteredHistory)}
                    onDelete={bulkDeleteSelected}
                  />
                )}
                {history.length > 0 && <GridSizeSlider columns={galleryColumns} onChange={setGalleryColumns} />}
              </div>
            </div>

            {history.length > 0 && (
              <div className="flex gap-2 mb-6 flex-wrap">
                <button onClick={() => setHistoryFilter(null)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 ${
                    historyFilter === null
                      ? "bg-zinc-900 text-white shadow-sm"
                      : "bg-black/[0.035] text-zinc-600 hover:text-zinc-800"
                  }`}>
                  All · {history.length}
                </button>
                {MODELS.map((m) => {
                  const count = history.filter((img) => img.model === m.id).length;
                  if (count === 0) return null;
                  return (
                    <button key={m.id} onClick={() => setHistoryFilter(historyFilter === m.id ? null : m.id)}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 ${
                        historyFilter === m.id
                          ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25"
                          : "bg-black/[0.035] text-zinc-600 hover:text-orange-500"
                      }`}>
                      {m.name} · {count}
                    </button>
                  );
                })}
              </div>
            )}

            {filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4">
                <div className="animate-float logo-glow">
                  <Image src="/logo.png" alt="Petpho mascot" width={120} height={120} className="w-28 h-28" />
                </div>
                <p className="text-base font-semibold text-zinc-700">
                  {history.length === 0 ? "No images yet" : "No results found"}
                </p>
                <p className="text-sm text-zinc-600">
                  {history.length === 0 ? "Generate your first Pixar pet portrait" : "Try a different search or filter"}
                </p>
              </div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${galleryColumns}, minmax(0, 1fr))` }}>
                {filteredHistory.map((img, i) => (
                  <ImageCard
                    key={`hist-${img.url}-${i}`}
                    img={img}
                    index={i}
                    showDate
                    isBroken={brokenImages.has(img.url)}
                    onBroken={() => markBroken(img.url)}
                    onOpen={() => openEditor(img)}
                    onEdit={() => openEditor(img)}
                    onScene={() => openCompose(img)}
                    onRemove={() => removeFromHistory(img.url)}
                    onViewOriginal={() => img.uploadUrl && setLightbox(img.uploadUrl)}
                    selectMode={selectMode}
                    selected={selectedUrls.has(img.url)}
                    onToggleSelect={() => toggleSelected(img.url)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Cutout touch-up */}
      {refining && composeTarget && petOriginalUrl && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-6 animate-fade-in">
          <div className={`${floatCard} w-full max-w-5xl h-[90vh] p-5 flex flex-col gap-3 animate-scale-in`}>
            <div className="flex items-center justify-between gap-4 flex-shrink-0">
              <div>
                <h3 className="font-bold text-zinc-900 text-sm">Touch up the cutout</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Erase leftover background, or restore parts of the pet that got trimmed
                </p>
              </div>
              <button onClick={() => setRefining(false)}
                className="w-8 h-8 rounded-full bg-black/[0.04] hover:bg-black/[0.1] text-zinc-600 hover:text-zinc-900 transition-all flex items-center justify-center flex-shrink-0">
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 flex-shrink-0">
              <div className="flex gap-2">
                <button onClick={() => setRefineTool("erase")}
                  className={`px-3 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${refineTool === "erase" ? chipOn : chipOff}`}>
                  🧽 Erase
                </button>
                <button onClick={() => setRefineTool("restore")}
                  className={`px-3 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${refineTool === "restore" ? chipOn : chipOff}`}>
                  ↩ Restore
                </button>
              </div>
              <div className="flex flex-col gap-1 w-36">
                <label className={label}>
                  Brush — <span className="text-orange-400">{refineBrush}px</span>
                </label>
                <input type="range" min={5} max={120} value={refineBrush}
                  onChange={(e) => setRefineBrush(Number(e.target.value))} className="w-full" />
              </div>

              {/* Zoom */}
              <div className="flex items-center gap-1 bg-black/[0.035] rounded-full p-1">
                <button onClick={() => zoomRefine(1 / 1.25)} title="Zoom out"
                  className="w-7 h-7 rounded-full text-zinc-600 hover:bg-white hover:text-zinc-900 transition-all flex items-center justify-center text-sm font-bold">
                  −
                </button>
                <span className="text-[11px] font-semibold text-zinc-600 w-11 text-center tabular-nums">
                  {Math.round(refineZoom * 100)}%
                </span>
                <button onClick={() => zoomRefine(1.25)} title="Zoom in"
                  className="w-7 h-7 rounded-full text-zinc-600 hover:bg-white hover:text-zinc-900 transition-all flex items-center justify-center text-sm font-bold">
                  +
                </button>
                <button onClick={() => setRefineZoom(fitRefineZoom(refineDims))} title="Fit the whole image in view"
                  className="px-2.5 h-7 rounded-full text-[11px] font-bold text-zinc-600 hover:bg-white hover:text-zinc-900 transition-all">
                  Fit
                </button>
                <button onClick={() => setRefineZoom(1)} title="Actual size"
                  className="px-2.5 h-7 rounded-full text-[11px] font-bold text-zinc-600 hover:bg-white hover:text-zinc-900 transition-all">
                  1:1
                </button>
              </div>

              <button onClick={() => refinerRef.current?.reset()}
                className={`px-3 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${chipOff}`}>
                Reset
              </button>

              <p className="text-[11px] text-zinc-400 ml-auto hidden sm:block">
                Scroll to pan · ⌘/Ctrl + scroll to zoom
              </p>
            </div>

            <div
              ref={refineViewRef}
              className="flex-1 min-h-0 overflow-auto rounded-2xl bg-black/[0.03] ring-1 ring-black/[0.05] flex p-4"
            >
              <CutoutRefiner
                ref={refinerRef}
                cutoutUrl={composeTarget.url}
                originalUrl={petOriginalUrl}
                brushSize={refineBrush}
                tool={refineTool}
                zoom={refineZoom}
                onReady={(w, h) => {
                  setRefineDims({ w, h });
                  setRefineZoom(fitRefineZoom({ w, h }));
                }}
              />
            </div>

            {composeError && <p className={`${errorBox} flex-shrink-0`}>{composeError}</p>}

            <div className="flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setRefining(false)}
                className={`px-4 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${chipOff}`}>
                Cancel
              </button>
              <button onClick={applyRefinedCutout} disabled={savingRefine}
                className="px-4 py-2 rounded-full text-xs font-bold bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2">
                {savingRefine
                  ? (<><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</>)
                  : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex z-50 animate-fade-in"
          onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl bg-black/[0.06] hover:bg-black/[0.15] w-10 h-10 rounded-full flex items-center justify-center transition-all z-10"
            onClick={() => setLightbox(null)}>
            ✕
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
            disabled={lightboxIndex <= 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-2xl bg-black/[0.06] hover:bg-black/[0.15] disabled:opacity-0 disabled:pointer-events-none w-10 h-10 rounded-full flex items-center justify-center transition-all z-10"
          >
            ‹
          </button>

          <div className="flex-1 flex items-center justify-center p-8 min-w-0">
            <Image src={lightbox} alt="Preview" width={1024} height={1024}
              className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl animate-scale-in"
              unoptimized priority onClick={(e) => e.stopPropagation()} />
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
            disabled={lightboxIndex === -1 || lightboxIndex >= history.length - 1}
            className="absolute right-[6.5rem] top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-2xl bg-black/[0.06] hover:bg-black/[0.15] disabled:opacity-0 disabled:pointer-events-none w-10 h-10 rounded-full flex items-center justify-center transition-all z-10"
          >
            ›
          </button>

          {history.length > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-24 flex-shrink-0 h-full overflow-y-auto flex flex-col gap-2 p-3 pt-16"
            >
              {history.map((img, i) => (
                <button key={`${img.url}-${i}`} onClick={() => setLightbox(img.url)}
                  className={`relative rounded-lg overflow-hidden aspect-square flex-shrink-0 ring-2 transition-all duration-150 ${
                    img.url === lightbox
                      ? "ring-orange-400 scale-[1.03]"
                      : "ring-transparent opacity-60 hover:opacity-100 hover:ring-white/40"
                  }`}>
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
