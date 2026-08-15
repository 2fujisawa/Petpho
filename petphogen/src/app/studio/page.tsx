"use client";

import Image from "next/image";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { MODELS, DEFAULT_MODEL, COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, EDIT_MODELS, DEFAULT_EDIT_MODEL, getComposeModelConfig, getEditModelConfig, getModelConfig, VIDEO_MODELS, DEFAULT_VIDEO_MODEL, VIDEO_RESOLUTIONS, VIDEO_ASPECT_RATIOS, VIDEO_DURATIONS, getVideoModelConfig, type ModelId, type ModelConfig, type VideoModelId } from "@/lib/models";
import { PREMADE_BACKGROUNDS } from "@/lib/premadeBackgrounds";
import { STYLES, DEFAULT_STYLE, getStyleConfig, type StyleId } from "@/lib/styles";

const ASPECT_RATIOS = [
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
];

// Flux Fill Pro has no native resolution input — matches the tiers the
// server upscales to post-generation (see RESOLUTION_PX in /api/inpaint).
const EDITOR_RESOLUTIONS = ["1K", "2K", "4K"];

function aspectRatioToNumber(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

// Positions a content box (its own natural aspect ratio) inside a frame of a
// possibly different aspect ratio, centered and never cropped — letterboxed
// (bars top/bottom) or pillarboxed (bars left/right) depending on which is
// relatively wider. Returns absolute-position CSS percentages for the content
// box within a `position: relative` frame of the same size as the outer stage.
// The same fit expressed as plain numbers — the size, in % of the frame, that
// the content occupies when centred and uncropped. Used where the rect has to
// be scaled/repositioned rather than just handed to CSS.
function letterboxSizePct(contentAspect: number | null, frameAspect: number) {
  if (!contentAspect) return { w: 100, h: 100 };
  return contentAspect > frameAspect
    ? { w: 100, h: (frameAspect / contentAspect) * 100 }
    : { w: (contentAspect / frameAspect) * 100, h: 100 };
}

function letterboxRect(contentAspect: number | null, frameAspect: number): React.CSSProperties {
  if (!contentAspect) return { inset: 0 };
  return contentAspect > frameAspect
    ? {
        left: 0,
        width: "100%",
        top: `${(100 - (frameAspect / contentAspect) * 100) / 2}%`,
        height: `${(frameAspect / contentAspect) * 100}%`,
      }
    : {
        top: 0,
        height: "100%",
        left: `${(100 - (contentAspect / frameAspect) * 100) / 2}%`,
        width: `${(contentAspect / frameAspect) * 100}%`,
      };
}

type GeneratedImage = {
  url: string;
  prompt: string;
  model: ModelId;
  sourceUrl?: string;
  uploadUrl?: string;
  createdAt?: number;
  // Present only on results produced by the inpaint editor — lets reopening
  // this image restore the ratio/resolution/model it was made with, instead
  // of falling back to whatever the editor currently defaults to.
  editSettings?: { aspectRatio: string; resolution: string; model: ModelId };
};

type EditorState = {
  sourceImage: GeneratedImage;
  editPrompt: string;
  model: ModelId;
  aspectRatio: string; // "original" or e.g. "16:9" — non-original outpaints the canvas
  resolution: string; // "original" or e.g. "2K" — non-original upscales the result
  loading: boolean;
  error: string | null;
};

// One in-flight (or failed) "Apply Edit" call. Tracked outside EditorState so
// firing another edit — even against a different photo or model — never has
// to wait on this one, and switching away from the editor doesn't lose track
// of it: it keeps running and lands in history regardless.
type EditJob = {
  id: string;
  thumbnailUrl: string;
  model: ModelId;
  error?: string;
};

type GeneratedVideo = {
  url: string;
  prompt: string;
  model: VideoModelId;
  // The still it was animated from, when it wasn't plain text-to-video.
  sourceUrl?: string;
  createdAt?: number;
};

// Same shape and reasoning as EditJob — a clip takes minutes, so it has to keep
// running while you queue more, switch tabs, or go back to editing.
type VideoJob = {
  id: string;
  thumbnailUrl?: string;
  model: VideoModelId;
  error?: string;
};

type InpaintCanvasHandle = {
  getMaskDataUrl: () => string | null;
  clear: () => void;
};

const InpaintCanvas = forwardRef<
  InpaintCanvasHandle,
  {
    imageUrl: string;
    brushSize: number;
    tool: "brush" | "eraser";
    // False while the photo is being positioned, so drags move it instead of
    // painting on it.
    interactive?: boolean;
    onImageLoad?: (w: number, h: number) => void;
  }
>(function InpaintCanvas({ imageUrl, brushSize, tool, interactive = true, onImageLoad }, ref) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // Pointer position (canvas-relative CSS px) for the brush-size preview ring —
  // same brush affordance as the cutout touch-up tool.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

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

  function updateCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = displayRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = displayRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
      radius: (brushSize / r.width) * c.width,
    };
  }

  // Stroke from the previous point to the current one rather than stamping a
  // lone circle per event — a fast drag then paints a continuous band instead
  // of a dotted trail. Same approach as the touch-up brush.
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const { x, y, radius } = getPos(e);
    const last = lastRef.current ?? { x, y };
    const dctx = displayRef.current!.getContext("2d")!;
    const mctx = maskRef.current!.getContext("2d")!;

    for (const ctx of [dctx, mctx]) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = radius * 2;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
    }

    if (tool === "brush") {
      dctx.strokeStyle = "rgba(255, 80, 0, 0.5)"; dctx.stroke();
      mctx.strokeStyle = "#fff"; mctx.stroke();
    } else {
      dctx.save();
      dctx.globalCompositeOperation = "destination-out";
      dctx.strokeStyle = "rgba(0,0,0,1)"; dctx.stroke();
      dctx.restore();
      mctx.strokeStyle = "#000"; mctx.stroke();
    }
    lastRef.current = { x, y };
  }

  function endStroke() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  return (
    <div className="absolute inset-0 select-none rounded-2xl overflow-hidden ring-1 ring-orange-400/25">
      <img src={imageUrl} alt="Inpaint target" className="w-full h-full block object-contain" draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          initCanvases(img.naturalWidth, img.naturalHeight);
          onImageLoad?.(img.naturalWidth, img.naturalHeight);
        }} />
      <canvas ref={displayRef}
        className={`absolute inset-0 w-full h-full ${interactive ? "cursor-none" : "pointer-events-none"}`}
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawingRef.current = true;
          lastRef.current = null;
          updateCursor(e);
          paint(e);
        }}
        onPointerMove={(e) => { updateCursor(e); paint(e); }}
        onPointerUp={endStroke}
        onPointerLeave={() => { endStroke(); setCursor(null); }} />
      {interactive && cursor && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-orange-400 bg-orange-400/10"
          style={{
            left: cursor.x,
            top: cursor.y,
            width: brushSize * 2,
            height: brushSize * 2,
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
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
  // Pointer position (container-relative CSS px) for the brush-size preview ring.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
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
  // Caller remounts this component (via `key`) when cutoutUrl/originalUrl
  // change, so `ready` already starts false — no need to reset it here.
  useEffect(() => {
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

  function updateCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

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
        className="block w-full h-full cursor-none"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawingRef.current = true;
          lastRef.current = null;
          updateCursor(e);
          stroke(e);
        }}
        onPointerMove={(e) => { updateCursor(e); stroke(e); }}
        onPointerUp={endStroke}
        onPointerLeave={() => { endStroke(); setCursor(null); }}
      />
      {ready && cursor && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-orange-400 bg-orange-400/10"
          style={{
            left: cursor.x,
            top: cursor.y,
            width: brushSize * 2,
            height: brushSize * 2,
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
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

// A plain `<a download>` is ignored by browsers for cross-origin URLs (Blob
// storage / Replicate are both cross-origin from this app) — they just
// navigate to the image instead of downloading it. Fetching the bytes and
// saving via a same-origin blob: URL makes the download attribute honored.
// Full-size copy for the Originals library. Only shrinks when the file is big
// enough to risk the upload limit — otherwise the bytes go through untouched.
async function makeArchiveFile(file: File): Promise<File> {
  const MAX_BYTES = 8 * 1024 * 1024;
  if (file.size <= MAX_BYTES) return file;
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 2560;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file);
        },
        "image/jpeg",
        0.9
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// localStorage is a hard ~5MB per origin and throws once it's full. History
// only grows, so an unguarded write eventually throws inside a render effect
// and takes the page down. Drop the oldest entries and retry instead.
function persistJson(key: string, value: unknown, trim?: (v: never, keep: number) => unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    for (const keep of [400, 150, 50]) {
      try {
        localStorage.setItem(key, JSON.stringify(trim ? trim(value as never, keep) : value));
        return;
      } catch {}
    }
    console.warn(`Could not persist ${key} — storage is full.`);
  }
}

async function downloadImage(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = url.split("/").pop()?.split("?")[0] || "petpho.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
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
                  <button onClick={(e) => { e.stopPropagation(); downloadImage(img.url); }}
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${overlayChip}`}>
                    ↓
                  </button>
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
  // The untouched file, kept alongside the downscaled copy sent to the model so
  // the Originals library archives the real photo at its real size.
  const [photoOriginal, setPhotoOriginal] = useState<File | null>(null);
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
  // The stage box is shaped to the chosen output ratio, which usually doesn't
  // match the background photo's own ratio — this is the actual rendered
  // rect of the photo *inside* that box (letterboxed, not cropped). Pet
  // placement math is measured against this, not the stage, so 0-100%
  // always means "0-100% of the real photo," matching what the backend
  // composites onto (it uses the photo's full, uncropped pixel dimensions).
  const imageAreaRef = useRef<HTMLDivElement>(null);
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
  // Remembers cutouts by source photo URL so a background removal survives
  // switching tabs and away from Compose — reopening the same photo restores
  // the already-removed background instead of asking to redo the work.
  const [cutoutCache, setCutoutCache] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"generate" | "history" | "originals" | "video">("generate");
  // Source pet photos, listed from blob storage rather than derived from
  // history's uploadUrl — that field only exists for images generated in this
  // browser, so it misses everything created on another device.
  const [originalUploads, setOriginalUploads] = useState<{ url: string; createdAt: number }[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<ModelId | null>(null);
  const [galleryColumns, setGalleryColumns] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [showGenSettings, setShowGenSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [numOutputs, setNumOutputs] = useState(1);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [artStyle, setArtStyle] = useState<StyleId>(DEFAULT_STYLE);
  const [resolution, setResolution] = useState("2K");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Sticky across photos, so switching what you're editing keeps the model you
  // picked rather than snapping back to the default every time.
  const [editModel, setEditModel] = useState<ModelId>(DEFAULT_EDIT_MODEL);
  // Edits currently running (or that failed) — see EditJob above.
  const [editJobs, setEditJobs] = useState<EditJob[]>([]);
  // Natural aspect ratio of the photo currently in the editor — used to size
  // the Output Size guide frame around it (mirrors bgAspect in Compose).
  const [editorImgAspect, setEditorImgAspect] = useState<number | null>(null);
  // Cleared during render (not an effect) when the source photo changes, so
  // the guide frame never briefly shows the previous photo's shape — this is
  // React's own recommended pattern for resetting state when a prop changes.
  const [editorAspectForUrl, setEditorAspectForUrl] = useState<string | undefined>(undefined);
  if (editor && editor.sourceImage.url !== editorAspectForUrl) {
    setEditorAspectForUrl(editor.sourceImage.url);
    setEditorImgAspect(null);
  }
  // Where the photo sits inside an expanded output canvas, and how big it is
  // there (100 = as large as it can be without cropping). Only meaningful once
  // Output Size differs from the photo's own shape.
  const [editorPhotoPos, setEditorPhotoPos] = useState({ x: 50, y: 50 });
  const [editorPhotoScale, setEditorPhotoScale] = useState(100);
  // Reset placement whenever the photo or the target shape changes — the old
  // numbers describe a canvas that no longer exists. Render-time reset, same
  // pattern as above.
  const placementKey = editor ? `${editor.sourceImage.url}|${editor.aspectRatio}` : "";
  const [placementKeyState, setPlacementKeyState] = useState("");
  if (editor && placementKey !== placementKeyState) {
    setPlacementKeyState(placementKey);
    setEditorPhotoPos({ x: 50, y: 50 });
    setEditorPhotoScale(100);
  }
  const editorStageRef = useRef<HTMLDivElement>(null);
  const draggingPhotoRef = useRef(false);
  const photoResizeRef = useRef<{ sx: number; sy: number; ax: number; ay: number; ratio: number } | null>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [brushTool, setBrushTool] = useState<"brush" | "eraser" | "move">("brush");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const inpaintCanvasRef = useRef<InpaintCanvasHandle>(null);
  const editorViewRef = useRef<HTMLElement>(null);
  const historyInitialSaveSkipped = useRef(false);
  const cutoutCacheInitialSaveSkipped = useRef(false);
  // ── Video (Seedance) ──
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [videoJobs, setVideoJobs] = useState<VideoJob[]>([]);
  const [videoSourceUrl, setVideoSourceUrl] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoModel, setVideoModel] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL);
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoAspect, setVideoAspect] = useState("adaptive");
  const [videoAudio, setVideoAudio] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videosInitialSaveSkipped = useRef(false);

  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Must load in an effect, not a useState initializer: localStorage isn't
    // available during SSR, so reading it eagerly would make the client's
    // first render disagree with the server-rendered HTML (hydration error).
    try {
      const saved = localStorage.getItem("petpho-history");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setHistory(JSON.parse(saved));
    } catch {}

    try {
      const savedVideos = localStorage.getItem("petpho-videos");
      if (savedVideos) setVideos(JSON.parse(savedVideos));
    } catch {}

    // Sync with blob storage so history follows the account, not the browser:
    // pick up images generated elsewhere, and drop local entries for images
    // that were deleted elsewhere (otherwise they'd linger here as "Expired").
    fetch("/api/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {
        images?: { url: string; createdAt: number }[];
        uploads?: { url: string; createdAt: number }[];
        videos?: { url: string; createdAt: number }[];
      } | null) => {
        if (!data) return;
        setOriginalUploads(data.uploads ?? []);

        // Same reconcile as history below: keep the local entries (they carry
        // the prompt and model, which storage doesn't), drop ones deleted
        // elsewhere, and adopt clips generated on another device.
        setVideos((prev) => {
          const live = new Set((data.videos ?? []).map((v) => v.url));
          const pruned = prev.filter(
            (v) => !v.url.includes(".public.blob.vercel-storage.com/") || live.has(v.url)
          );
          const known = new Set(pruned.map((v) => v.url));
          const recovered = (data.videos ?? [])
            .filter((v) => !known.has(v.url))
            .map((v) => ({
              url: v.url,
              prompt: "",
              model: "" as VideoModelId,
              createdAt: v.createdAt,
            }));
          if (pruned.length === prev.length && !recovered.length) return prev;
          return [...pruned, ...recovered].sort(
            (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
          );
        });
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
          // Infinity - Infinity is NaN, which Array.sort treats as "equal" but
          // inconsistently across engines — two undated entries could then
          // silently swap position on every render. 0 as the missing-date
          // floor keeps the subtraction real and just sorts them last.
          return [...pruned, ...recovered].sort(
            (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
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
    persistJson("petpho-history", history, (h: GeneratedImage[], keep) => h.slice(0, keep));
  }, [history]);

  useEffect(() => {
    if (!videosInitialSaveSkipped.current) {
      videosInitialSaveSkipped.current = true;
      return;
    }
    persistJson("petpho-videos", videos, (v: GeneratedVideo[], keep) => v.slice(0, keep));
  }, [videos]);

  // Cutout cache was in-memory only — it didn't survive a page refresh (or a
  // dev-server hot reload), which looked like "the removed background didn't
  // stick" even though the underlying file was still sitting in Blob storage.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("petpho-cutout-cache");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setCutoutCache(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (!cutoutCacheInitialSaveSkipped.current) {
      cutoutCacheInitialSaveSkipped.current = true;
      return;
    }
    persistJson("petpho-cutout-cache", cutoutCache);
  }, [cutoutCache]);

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


  // Fire-and-forget by design: everything the request needs is captured into
  // `snapshot` up front, so the call runs entirely independent of `editor`
  // afterward. That's what makes it safe to fire several of these back to
  // back — switch model, switch photo, switch tabs entirely — each one keeps
  // running and lands in history on its own; none of them block or cancel
  // another. The result never yanks the screen back to the editor either, it
  // just shows up where the rest of the photos are.
  async function handleApplyInpaint() {
    if (!editor || !editor.editPrompt.trim()) return;
    const maskDataUrl = inpaintCanvasRef.current?.getMaskDataUrl();
    if (!maskDataUrl) return;

    const snapshot = {
      sourceUrl: editor.sourceImage.url,
      maskDataUrl,
      prompt: editor.editPrompt,
      aspectRatio: editor.aspectRatio,
      resolution: editor.resolution,
      model: editor.model,
      photoX: editorPhotoPos.x,
      photoY: editorPhotoPos.y,
      photoScale: editorPhotoScale,
    };

    const job: EditJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      thumbnailUrl: snapshot.sourceUrl,
      model: snapshot.model,
    };
    setEditJobs((jobs) => [job, ...jobs]);
    // Clear the prompt so a second click can't resend the same text by
    // accident — the brush strokes are left alone, since reusing the same
    // masked region with a different model is exactly the point.
    setEditor((e) => e && e.sourceImage.url === snapshot.sourceUrl ? { ...e, editPrompt: "" } : e);

    try {
      const res = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: snapshot.sourceUrl, maskDataUrl: snapshot.maskDataUrl, prompt: snapshot.prompt,
          aspectRatio: snapshot.aspectRatio === "original" ? undefined : snapshot.aspectRatio,
          resolution: snapshot.resolution === "original" ? undefined : snapshot.resolution,
          photoX: snapshot.photoX,
          photoY: snapshot.photoY,
          photoScale: snapshot.photoScale,
          model: snapshot.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inpaint failed");
      const now = Date.now();
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: snapshot.prompt, model: snapshot.model, sourceUrl: snapshot.sourceUrl,
        createdAt: now,
        editSettings: {
          aspectRatio: snapshot.aspectRatio, resolution: snapshot.resolution, model: snapshot.model,
        },
      }));
      setHistory((prev) => [...newImages, ...prev]);
      setEditJobs((jobs) => jobs.filter((j) => j.id !== job.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setEditJobs((jobs) => jobs.map((j) => (j.id === job.id ? { ...j, error: msg } : j)));
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
    // Keep what the user actually handed us. The compressed copy below is all
    // the model needs, but archiving that instead was storing a 1024px,
    // aspect-padded canvas in place of their real photo.
    setPhotoOriginal(file);
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

  // Object URLs pin the whole blob in memory until explicitly revoked. These
  // previews get replaced every time a photo is picked, so without this each
  // swap leaked a full-size image for the life of the tab. The cleanup runs
  // with the *previous* value, which is exactly the one going out of scope.
  // Only blob: URLs are ours — premade backgrounds are plain paths.
  useEffect(() => {
    if (!photoPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    if (!backgroundPhotoPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(backgroundPhotoPreview);
  }, [backgroundPhotoPreview]);

  // Paste an image straight onto the Create tab. Text pastes are left alone so
  // the prompt box keeps working normally.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (composeTarget || editor || activeTab !== "generate") return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      handleFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [composeTarget, editor, activeTab]);

  async function reuseOriginalPhoto(url: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], "original-photo.jpg", { type: blob.type || "image/jpeg" });
    handleFile(file);
    setActiveTab("generate");
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
        const srcUrl = URL.createObjectURL(photo);
        img.onload = () => {
          URL.revokeObjectURL(srcUrl);
          const [arW, arH] = (aspectRatio || "3:4").split(":").map(Number);
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
        img.onerror = () => { URL.revokeObjectURL(srcUrl); resolve(photo!); };
        img.src = srcUrl;
      });

      const formData = new FormData();
      formData.append("photo", zoomedPhoto);
      if (photoOriginal) {
        formData.append("originalPhoto", await makeArchiveFile(photoOriginal));
      }
      formData.append("prompt", prompt.trim());
      formData.append("aspectRatio", aspectRatio);
      formData.append("numOutputs", String(numOutputs));
      formData.append("model", model);
      formData.append("style", artStyle);
      formData.append("resolution", resolution);

      const res = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      const now = Date.now();
      const uploadUrl = data.uploadUrl as string | undefined;
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: prompt || `${getStyleConfig(artStyle).name} style`, model, createdAt: now, uploadUrl,
      }));
      setHistory((prev) => [...newImages, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function openEditor(img: GeneratedImage) {
    // A photo the editor itself produced remembers the ratio/resolution/model
    // it was made with, so picking it back up starts from where that edit
    // left off rather than the (possibly unrelated) current defaults.
    const settings = img.editSettings;
    setEditor({
      sourceImage: img, editPrompt: "",
      model: settings?.model ?? editModel,
      aspectRatio: settings?.aspectRatio ?? "original",
      resolution: settings?.resolution ?? "original",
      loading: false, error: null,
    });
    if (settings?.model) setEditModel(settings.model);
  }

  function openCompose(img: GeneratedImage) {
    const cachedCutout = cutoutCache[img.url];
    setComposeTarget(cachedCutout ? { ...img, url: cachedCutout } : img);
    // The restore target is the *original* photo, never the cutout — pointing
    // it at the cutout made Restore a no-op for cached cutouts.
    setPetOriginalUrl(cachedCutout ? img.url : null);
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
      setCutoutCache((c) => ({ ...c, [composeTarget.url]: data.url }));
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

  // Multiplicative so a notch feels the same at 10px as at 100px, but always
  // moves at least 1px so small sizes don't get stuck rounding back to
  // themselves.
  function stepBrush(size: number, deltaY: number) {
    const next = deltaY < 0 ? Math.max(size + 1, size * 1.1) : Math.min(size - 1, size * 0.9);
    return clamp(Math.round(next), 5, 120);
  }

  // Wheel over the canvas resizes the brush; Ctrl/⌘ + wheel zooms. Registered
  // natively because React's wheel listener is passive, so preventDefault there
  // wouldn't stop the page scrolling / browser zooming.
  useEffect(() => {
    const el = refineViewRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setRefineZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 0.89), 0.05, 8));
      } else {
        setRefineBrush((s) => stepBrush(s, e.deltaY));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [refining]);

  // Same behaviour for the inpaint editor canvas.
  useEffect(() => {
    const el = editorViewRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCanvasZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 0.89), 0.5, 3));
      } else {
        setBrushSize((s) => stepBrush(s, e.deltaY));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editor]);

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
      if (petOriginalUrl) setCutoutCache((c) => ({ ...c, [petOriginalUrl]: data.url }));
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
    // Drop the cached cutout too — otherwise reopening this photo in Compose
    // would auto-apply it again, undoing the restore the user just asked for.
    setCutoutCache((c) => {
      const rest = { ...c };
      delete rest[petOriginalUrl];
      return rest;
    });
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
    const area = imageAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
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
    const area = imageAreaRef.current;
    if (!r || !area) return;
    const rect = area.getBoundingClientRect();
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
      const composedAt = Date.now();
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: composeTarget.prompt + " (placed in scene)",
        model: composeModel, sourceUrl: composeTarget.url, createdAt: composedAt,
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

  // Original pet photos you uploaded, so you can reuse one for a new
  // generation instead of digging up the file again. Blob storage is the
  // source of truth (works on any device); anything generated in this browser
  // since the last sync is unioned in so a fresh upload shows up immediately.
  const originalPhotos = Array.from(
    new Map([
      ...originalUploads.map((u) => [u.url, u] as const),
      ...history
        // Locally-remembered uploadUrls from before the full-size fix point at
        // the legacy padded canvases; the server already excludes those, so
        // don't let stale localStorage put them back on the tab.
        .filter((img) => img.uploadUrl?.includes("/petpho/originals/"))
        .map((img) => [img.uploadUrl!, { url: img.uploadUrl!, createdAt: img.createdAt ?? 0 }] as const),
    ]).values()
  ).sort((a, b) => b.createdAt - a.createdAt);

  const lightboxIndex = lightbox ? history.findIndex((img) => img.url === lightbox) : -1;

  function navigateLightbox(delta: number) {
    if (lightboxIndex === -1) return;
    const next = lightboxIndex + delta;
    if (next >= 0 && next < history.length) setLightbox(history[next].url);
  }

  // The stage is shaped to the chosen output ratio so you can see the target
  // frame — but the photo itself is never cropped or letterbox-filled to
  // match it. It stays at its own natural size, centered inside that frame,
  // with a dashed border marking how far the final canvas extends beyond it
  // (the model fills that extra area generatively at render time).
  const previewAspect =
    composeAspectRatio !== "auto" ? aspectRatioToNumber(composeAspectRatio) : bgAspect ?? 16 / 9;

  const imageAreaStyle = letterboxRect(bgAspect, previewAspect);

  // Same idea for the editor's Output Size: the canvas is shown at its own
  // natural size inside a dashed frame shaped like the chosen outpaint ratio.
  const editorPreviewAspect =
    editor && editor.aspectRatio !== "original" ? aspectRatioToNumber(editor.aspectRatio) : editorImgAspect ?? 1;

  // Size the photo would occupy if simply centred and uncropped — the 100%
  // reference that editorPhotoScale is a fraction of.
  const editorFit = letterboxSizePct(editorImgAspect, editorPreviewAspect);
  const editorPhotoW = editorFit.w * (editorPhotoScale / 100);
  const editorPhotoH = editorFit.h * (editorPhotoScale / 100);
  const editorPlaceable = !!editor && editor.aspectRatio !== "original";
  // Move only means something when there's spare canvas around the photo, so
  // it quietly falls back to the brush if Output Size returns to Original.
  const editorTool = brushTool === "move" && !editorPlaceable ? "brush" : brushTool;

  const editorAreaStyle: React.CSSProperties = editorPlaceable
    ? {
        left: `${editorPhotoPos.x - editorPhotoW / 2}%`,
        top: `${editorPhotoPos.y - editorPhotoH / 2}%`,
        width: `${editorPhotoW}%`,
        height: `${editorPhotoH}%`,
      }
    : letterboxRect(editorImgAspect, editorPreviewAspect);

  // Keep the photo fully inside the canvas — anything outside would be cropped
  // away, which is exactly what this whole preview promises never happens.
  function clampPhotoPos(x: number, y: number, w: number, h: number) {
    return {
      x: clamp(x, w / 2, 100 - w / 2),
      y: clamp(y, h / 2, 100 - h / 2),
    };
  }

  function startPhotoResize(e: React.PointerEvent, sx: number, sy: number) {
    e.preventDefault();
    e.stopPropagation();
    photoResizeRef.current = {
      sx,
      sy,
      // The opposite corner stays pinned while dragging.
      ax: editorPhotoPos.x - (sx * editorPhotoW) / 2,
      ay: editorPhotoPos.y - (sy * editorPhotoH) / 2,
      ratio: editorPhotoH / editorPhotoW,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPhotoResize(e: React.PointerEvent) {
    const r = photoResizeRef.current;
    const stage = editorStageRef.current;
    if (!r || !stage) return;
    const rect = stage.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const newW = clamp(Math.abs(px - r.ax), editorFit.w * 0.2, editorFit.w);
    const newH = newW * r.ratio;
    setEditorPhotoScale(clamp((newW / editorFit.w) * 100, 20, 100));
    setEditorPhotoPos(
      clampPhotoPos(r.ax + (r.sx * newW) / 2, r.ay + (r.sy * newH) / 2, newW, newH)
    );
  }

  function endPhotoResize() {
    photoResizeRef.current = null;
  }

  // Zoom drives real layout width (not a CSS transform) so the scroll parent
  // actually grows with it and you get true horizontal *and* vertical
  // scrolling to reach every part of a zoomed-in canvas — a transform leaves
  // layout size untouched, so the overflow is unreachable.
  // Deliberately no "%" term: this box lives inside a shrink-to-fit ancestor,
  // where a percentage has nothing definite to resolve against and collapses
  // the whole min() to 0.
  const editorStageWidth = `calc(min(640px, (100vh - 260px) * ${editorPreviewAspect}) * ${canvasZoom})`;

  const sidebarActive = composeTarget || editor ? "history" : activeTab;

  // Fire-and-forget, exactly like handleApplyInpaint: a clip takes minutes, so
  // everything the request needs is captured up front and the call is decoupled
  // from the UI. Queue several, change the settings, leave the tab — each one
  // finishes on its own and lands in the Video gallery.
  function handleGenerateVideo() {
    if (!videoPrompt.trim()) return;

    const snapshot = {
      imageUrl: videoSourceUrl,
      prompt: videoPrompt,
      model: videoModel,
      duration: videoDuration,
      resolution: videoResolution,
      aspectRatio: videoAspect,
      generateAudio: videoAudio,
    };
    const job: VideoJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      thumbnailUrl: snapshot.imageUrl ?? undefined,
      model: snapshot.model,
    };

    setVideoJobs((jobs) => [job, ...jobs]);
    setVideoError(null);
    setVideoPrompt("");

    (async () => {
      try {
        // Start the render, then poll. The request that starts it returns in a
        // second or two — deliberately not held open for the whole render,
        // which routinely outlasts the hosting platform's function timeout.
        const res = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snapshot),
        });
        const started = await res.json();
        if (!res.ok) throw new Error(started.error || "Video generation failed");

        let data: { status?: string; url?: string; error?: string } = {};
        const deadline = Date.now() + 30 * 60 * 1000; // give up after 30 min
        for (;;) {
          if (Date.now() > deadline) {
            throw new Error("Timed out waiting for the video — check Replicate for the result.");
          }
          await new Promise((r) => setTimeout(r, 5000));
          const poll = await fetch(`/api/video?id=${encodeURIComponent(started.id)}`);
          data = await poll.json();
          if (data.status === "succeeded") break;
          if (!poll.ok || data.status === "failed") {
            throw new Error(data.error || "Video generation failed");
          }
        }

        setVideos((prev) => [
          {
            url: data.url!,
            prompt: snapshot.prompt,
            model: snapshot.model,
            sourceUrl: snapshot.imageUrl ?? undefined,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        setVideoJobs((jobs) => jobs.filter((j) => j.id !== job.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Video generation failed";
        // Kept in the job tile rather than a banner, so a failure from one clip
        // can't be mistaken for a failure of the one still running.
        setVideoJobs((jobs) =>
          jobs.map((j) => (j.id === job.id ? { ...j, error: message } : j))
        );
      }
    })();
  }

  async function removeVideo(url: string) {
    setVideos((prev) => prev.filter((v) => v.url !== url));
    await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
  }

  function navTo(tab: "generate" | "history" | "originals" | "video") {
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
    // A blob URL that won't load is usually a transient network blip, so keep
    // the card and let the user decide. A non-blob URL is a different story: it
    // means archiving to storage failed at generation time and this is a raw
    // Replicate link, which expires after about an hour and can never come
    // back. Nothing is recoverable there, so drop it instead of leaving an
    // "Expired" tombstone the user has to clear by hand.
    if (!url.includes(".public.blob.vercel-storage.com/")) {
      setHistory((h) => h.filter((x) => x.url !== url));
      return;
    }
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

  function selectAllVisible(list: { url: string }[]) {
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

  function bulkDeleteSelectedOriginals() {
    if (selectedUrls.size === 0) return;
    if (!confirm(`Delete ${selectedUrls.size} original photo${selectedUrls.size !== 1 ? "s" : ""}? This can't be undone.`)) return;
    const urls = Array.from(selectedUrls);
    setOriginalUploads((list) => list.filter((p) => !selectedUrls.has(p.url)));
    // Drop the pointer from any generated image that referenced this upload,
    // otherwise its "Original" button would open a dead link.
    setHistory((h) =>
      h.map((img) => (img.uploadUrl && selectedUrls.has(img.uploadUrl) ? { ...img, uploadUrl: undefined } : img))
    );
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
            { id: "originals" as const, icon: "🐾", name: "Originals" },
            { id: "video" as const, icon: "🎬", name: "Video" },
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
                {((item.id === "history" && history.length > 0) ||
                  (item.id === "originals" && originalPhotos.length > 0) ||
                  (item.id === "video" && videos.length + videoJobs.length > 0)) && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-colors duration-200 ${
                    active ? "bg-orange-400/15 text-orange-500" : "bg-black/[0.05] text-zinc-500"
                  }`}>
                    {item.id === "history"
                      ? history.length
                      : item.id === "originals"
                      ? originalPhotos.length
                      : videos.length + videoJobs.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <div className="px-3 pb-4">
          <button
            onClick={signOut}
            title="Sign out"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-zinc-500 hover:text-red-500 hover:bg-red-500/[0.06] transition-all duration-200"
          >
            <span className="text-[15px] leading-none">🚪</span>
          </button>
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
                {composeAspectRatio !== "auto" && (
                  <p className="text-[11px] text-zinc-500 leading-snug">
                    The dashed frame is the final canvas shape — your photo won&apos;t be cropped, the extra area gets filled in when generated
                  </p>
                )}
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
                    className="relative select-none"
                    style={{
                      aspectRatio: `${previewAspect}`,
                      // Bounded by whichever is tighter: the 640px design cap, the
                      // available width, or the available height translated through
                      // the ratio — otherwise a tall ratio (e.g. 9:16) computes its
                      // height purely from width and blows past the viewport.
                      width: `min(100%, 640px, calc((100vh - 96px) * ${previewAspect}))`,
                    }}
                  >
                    {/* Target-frame guide — the photo is never cropped/stretched to
                        this; it just marks how far the final canvas extends beyond
                        the photo once the model reframes it at render time. */}
                    {composeAspectRatio !== "auto" && (
                      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-orange-400/60 pointer-events-none">
                        <span className="absolute top-2 left-2 text-[10px] font-semibold bg-orange-500 text-white px-2 py-0.5 rounded-full">
                          {composeAspectRatio} frame
                        </span>
                      </div>
                    )}
                    <div
                      ref={imageAreaRef}
                      className="absolute rounded-2xl overflow-hidden ring-1 ring-black/[0.1] shadow-2xl shadow-black/50"
                      style={imageAreaStyle}
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
                            if (!draggingPetRef.current || !imageAreaRef.current) return;
                            const rect = imageAreaRef.current.getBoundingClientRect();
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
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] bg-black/60 backdrop-blur-sm text-white/80 px-3 py-1 rounded-full font-medium pointer-events-none whitespace-nowrap">
                        Drag to move · pull a corner to resize
                      </div>
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

            {/* Center: canvas + floating edit bar */}
            <div className="flex-1 relative overflow-hidden flex flex-col">
              {/* Single scroll container for both axes. m-auto (not
                  justify-center) keeps the card centred while it fits, without
                  clipping an edge out of reach once zoomed past the viewport. */}
              <section ref={editorViewRef} className="flex-1 overflow-auto p-6 flex">
                <div className={`${floatCard} p-4 m-auto flex-shrink-0`}>
                  <div
                    ref={editorStageRef}
                    className="relative select-none"
                    style={{
                      aspectRatio: `${editorPreviewAspect}`,
                      width: editorStageWidth,
                    }}
                    onPointerMove={(e) => {
                      if (!draggingPhotoRef.current || !editorStageRef.current) return;
                      const rect = editorStageRef.current.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      setEditorPhotoPos(clampPhotoPos(x, y, editorPhotoW, editorPhotoH));
                    }}
                    onPointerUp={() => { draggingPhotoRef.current = false; }}
                    onPointerLeave={() => { draggingPhotoRef.current = false; }}
                  >
                    {editor.aspectRatio !== "original" && (
                      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-orange-400/60 pointer-events-none">
                        <span className="absolute top-2 left-2 text-[10px] font-semibold bg-orange-500 text-white px-2 py-0.5 rounded-full">
                          {editor.aspectRatio} canvas
                        </span>
                      </div>
                    )}
                    <div
                      className={`absolute ${editorTool === "move" ? "ring-2 ring-orange-400 cursor-move" : ""}`}
                      style={{ ...editorAreaStyle, touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (editorTool !== "move") return;
                        draggingPhotoRef.current = true;
                        e.preventDefault();
                      }}
                    >
                      <InpaintCanvas
                        key={editor.sourceImage.url}
                        ref={inpaintCanvasRef}
                        imageUrl={editor.sourceImage.url}
                        brushSize={brushSize}
                        tool={editorTool === "eraser" ? "eraser" : "brush"}
                        interactive={editorTool !== "move"}
                        onImageLoad={(w, h) => setEditorImgAspect(w / h)}
                      />
                      {editorTool === "move" && (
                        <>
                          {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) => (
                            <div
                              key={`${sx}${sy}`}
                              onPointerDown={(e) => startPhotoResize(e, sx, sy)}
                              onPointerMove={onPhotoResize}
                              onPointerUp={endPhotoResize}
                              className="absolute w-3 h-3 bg-white border-2 border-orange-400 rounded-sm"
                              style={{
                                left: sx < 0 ? -6 : undefined,
                                right: sx > 0 ? -6 : undefined,
                                top: sy < 0 ? -6 : undefined,
                                bottom: sy > 0 ? -6 : undefined,
                                cursor: sx === sy ? "nwse-resize" : "nesw-resize",
                                touchAction: "none",
                              }}
                            />
                          ))}
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-orange-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                            {Math.round(editorPhotoScale)}%
                          </span>
                        </>
                      )}
                    </div>

                    {editorTool === "move" && (
                      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[11px] text-zinc-500 font-medium pointer-events-none whitespace-nowrap">
                        Drag to move · pull a corner to resize
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* Right panel: photo picker + tools */}
            <div className={`flex flex-col w-[300px] ${floatCard} p-4 gap-5 overflow-y-auto flex-shrink-0 my-6 mr-6`}>
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-zinc-900 text-sm flex-1">Editor</span>
                <button onClick={() => setEditor(null)} title="Browse all photos in a grid"
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold bg-black/[0.035] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.07] transition-all">
                  All photos
                </button>
              </div>

              {/* Switch which photo you're editing without leaving the canvas */}
              <div className="flex flex-col gap-2">
                <label className={label}>
                  Photos — {history.length}
                  {editJobs.length > 0 && (
                    <span className="text-orange-400"> · {editJobs.length} generating</span>
                  )}
                </label>
                <div className="max-h-[26vh] overflow-y-auto pr-0.5">
                {/* Stays 2-up on the widened panel so the thumbnails get
                    bigger rather than the panel just fitting more of them in. */}
                <div className="grid grid-cols-2 gap-2">
                  {editJobs.map((job) => (
                    <div key={job.id}
                      title={job.error ?? `Generating with ${getEditModelConfig(job.model).name}…`}
                      onClick={() => { if (job.error) setEditJobs((jobs) => jobs.filter((j) => j.id !== job.id)); }}
                      className={`relative rounded-lg overflow-hidden aspect-square ring-2 ${
                        job.error ? "ring-red-400 cursor-pointer" : "ring-orange-300/60"
                      }`}>
                      <img src={job.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-40" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                        {job.error
                          ? <span className="text-red-500 text-lg font-bold leading-none">!</span>
                          : <span className="w-5 h-5 border-2 border-orange-400/40 border-t-orange-400 rounded-full animate-spin" />}
                      </div>
                    </div>
                  ))}
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
              </div>

              <div className="border-t border-black/[0.05] pt-4 flex flex-col gap-2">
                <label className={label}>Tool</label>
                <button
                  onClick={() => setBrushTool("move")}
                  disabled={!editorPlaceable}
                  title={editorPlaceable
                    ? "Drag and resize the photo inside the output canvas"
                    : "Pick an Output Size other than Original first — there's no extra canvas to move within"}
                  className={`w-full py-2 rounded-full text-xs font-bold border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                    editorTool === "move" ? chipOn : chipOff
                  }`}>
                  ✥ Move &amp; Scale
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setBrushTool("brush")}
                    className={`flex-1 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${editorTool === "brush" ? chipOn : chipOff}`}>
                    🖌️ Brush
                  </button>
                  <button onClick={() => setBrushTool("eraser")}
                    className={`flex-1 py-2 rounded-full text-xs font-bold border transition-all duration-200 ${editorTool === "eraser" ? chipOn : chipOff}`}>
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
                <input type="range" min={5} max={120} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>
                  Zoom — <span className="text-orange-400">{Math.round(canvasZoom * 100)}%</span>
                </label>
                <input type="range" min={50} max={300} step={10} value={canvasZoom * 100} onChange={(e) => setCanvasZoom(Number(e.target.value) / 100)} className="w-full" />
                <p className="text-[11px] text-zinc-500 leading-snug">Scroll to pan · ⌘/Ctrl + scroll to zoom</p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex">
                  <ModelDropdown
                    value={editor.model}
                    models={EDIT_MODELS}
                    title="Model"
                    onChange={(id) => {
                      setEditModel(id);
                      setEditor((ed) => ed && { ...ed, model: id });
                    }}
                  />
                </div>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  {getEditModelConfig(editor.model).usesMask
                    ? "Repaints only what you brush — best for touch-ups and removals"
                    : "Better at adding new objects, but it redraws the whole image — your brush is passed as a hint, not a hard boundary"}
                </p>
              </div>

              <div className="flex gap-2">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <label className={label}>Output</label>
                  <div className="relative">
                    <select
                      value={editor.aspectRatio}
                      onChange={(e) => setEditor((ed) => ed && { ...ed, aspectRatio: e.target.value })}
                      className={selectBox}
                    >
                      <option value="original">Original</option>
                      {ASPECT_RATIOS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <Chevron />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 w-[86px] flex-shrink-0">
                  <label className={label}>Res</label>
                  <div className="relative">
                    <select
                      value={editor.resolution}
                      onChange={(e) => setEditor((ed) => ed && { ...ed, resolution: e.target.value })}
                      className={selectBox}
                    >
                      <option value="original">Original</option>
                      {EDITOR_RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <Chevron />
                  </div>
                </div>
              </div>

              {(editor.aspectRatio !== "original" || editor.resolution !== "original") && (
                <div className="flex flex-col gap-1 -mt-2">
                  {editor.aspectRatio !== "original" && (
                    <p className="text-[11px] text-zinc-500 leading-snug">The dashed frame is the new canvas shape — the extra area gets AI-filled to match the scene</p>
                  )}
                  {editor.resolution !== "original" && (
                    <p className="text-[11px] text-zinc-500 leading-snug">Upscales the result to {editor.resolution} after editing</p>
                  )}
                </div>
              )}

              <div className="border-t border-black/[0.05] pt-4 flex flex-col gap-2">
                <label className={label}>Edit Prompt</label>
                {editor.error && <p className={errorBox}>{editor.error}</p>}
                <div className="relative">
                  <textarea value={editor.editPrompt}
                    onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleApplyInpaint(); } }}
                    placeholder="Describe what to put in the brushed area…"
                    rows={3}
                    className="w-full bg-black/[0.035] rounded-xl text-sm p-3 pr-9 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/20 placeholder-zinc-500 text-zinc-900" />
                  <button
                    type="button"
                    onClick={() => toggleDictation(
                      (t) => setEditor((ed) => ed && { ...ed, editPrompt: ed.editPrompt ? `${ed.editPrompt} ${t}` : t }),
                      () => setEditor((ed) => ed && { ...ed, error: "Voice input isn't supported in this browser — try Chrome" }),
                    )}
                    title={listening ? "Stop listening" : "Dictate your edit"}
                    className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 ${
                      listening
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-black/[0.05] text-zinc-500 hover:text-zinc-800"
                    }`}>
                    <MicIcon />
                  </button>
                </div>
                <button onClick={handleApplyInpaint} disabled={!editor.editPrompt.trim()} title="Apply Inpaint — runs in the background, so you can start another edit right away"
                  className="btn-primary w-full py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center gap-2">
                  🖌️ Apply Edit
                </button>
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
                      {/* Edits started from the editor finish in the background
                          and land here, so show them cooking here too — otherwise
                          leaving the editor makes in-flight work look lost. */}
                      {editJobs.map((job) => (
                        <div key={`editjob-${job.id}`}
                          title={job.error ?? `Editing with ${getEditModelConfig(job.model).name}…`}
                          onClick={() => { if (job.error) setEditJobs((jobs) => jobs.filter((j) => j.id !== job.id)); }}
                          className={`relative rounded-2xl overflow-hidden bg-white ring-2 ${
                            job.error ? "ring-red-400 cursor-pointer" : "ring-orange-300/60"
                          }`}>
                          <img src={job.thumbnailUrl} alt="" className="w-full h-auto object-cover opacity-40" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/10">
                            {job.error ? (
                              <>
                                <span className="text-red-500 text-2xl font-bold leading-none">!</span>
                                <span className="text-[10px] font-semibold text-red-500 px-2 text-center">Edit failed — click to dismiss</span>
                              </>
                            ) : (
                              <>
                                <span className="w-7 h-7 border-2 border-orange-400/40 border-t-orange-400 rounded-full animate-spin" />
                                <span className="text-[10px] font-semibold text-zinc-600 bg-white/80 px-2 py-0.5 rounded-full">Editing…</span>
                              </>
                            )}
                          </div>
                        </div>
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
                      <ModelSwitcher value={model} onChange={(id) => {
                        setModel(id);
                        // Keep the resolution on something this model actually offers.
                        const opts = getModelConfig(id).supportedResolutions;
                        if (opts && !opts.includes(resolution)) setResolution(opts[0]);
                      }} compact />
                      <div className="flex flex-col gap-2">
                        <label className={label}>Art Style</label>
                        <div className="flex flex-wrap gap-1.5">
                          {STYLES.map((s) => (
                            <button key={s.id} onClick={() => setArtStyle(s.id)} title={s.description}
                              className={`text-xs px-2.5 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                                artStyle === s.id ? chipOn : chipOff
                              }`}>
                              {s.emoji} {s.name}
                            </button>
                          ))}
                        </div>
                      </div>
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
                          const cfg = getModelConfig(model);
                          const options = cfg.supportedResolutions;
                          if (!options) return null;
                          const idx = Math.max(0, options.indexOf(resolution));
                          return (
                            <div className="flex flex-col gap-2 w-28">
                              <label className={label}>
                                {cfg.resolutionParam === "quality" ? "Quality" : "Resolution"} — <span className="text-orange-400">{options[idx]}</span>
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
                        : <p className="text-xs text-zinc-500 bg-white/70 backdrop-blur-sm px-3 py-1 rounded-full">Upload or paste a pet photo to get started</p>}
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
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPhoto(null); setPhotoOriginal(null); setPhotoPreview(null); setPhotoZoom(1); }}
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
                      placeholder={photo ? `Describe your ${getStyleConfig(artStyle).name} scene… (optional)` : "Upload or paste a pet photo, then describe the scene…"}
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
                    <button onClick={handleGenerate} disabled={loading || !photo} title={`Generate ${getStyleConfig(artStyle).name} Art`}
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
                <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">
                  All photos
                </h2>
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

        {/* ORIGINALS TAB — the pet photos you uploaded, ready to reuse */}
        {!composeTarget && !editor && activeTab === "originals" && (
          <section className="flex-1 overflow-y-auto p-8 animate-fade-in">
            <div className="flex items-start justify-between mb-6 gap-4">
              <div className="animate-slide-in-left">
                <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">Original photos</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {originalPhotos.length === 0
                    ? "The pet photos you upload will collect here"
                    : selectMode
                    ? "Tap photos to select, then delete"
                    : "Pick one to reuse it for a new generation"}
                </p>
              </div>
              {originalPhotos.length > 0 && (
                <div className="flex items-center gap-3">
                  <SelectToolbar
                    selectMode={selectMode}
                    selectedCount={selectedUrls.size}
                    onToggle={() => { setSelectMode((v) => !v); setSelectedUrls(new Set()); }}
                    onSelectAll={() => selectAllVisible(originalPhotos)}
                    onDelete={bulkDeleteSelectedOriginals}
                  />
                  <GridSizeSlider columns={galleryColumns} onChange={setGalleryColumns} />
                </div>
              )}
            </div>

            {originalPhotos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4">
                <div className="animate-float logo-glow">
                  <Image src="/logo.png" alt="Petpho mascot" width={120} height={120} className="w-28 h-28" />
                </div>
                <p className="text-base font-semibold text-zinc-700">No original photos yet</p>
                <p className="text-sm text-zinc-600">Upload a pet photo on Create and it&apos;ll show up here</p>
              </div>
            ) : (
              // items-start stops the grid stretching every card to the tallest
              // in its row, which padded shorter photos with white and made them
              // look like a different shape than they actually are.
              <div className="grid gap-4 items-start" style={{ gridTemplateColumns: `repeat(${galleryColumns}, minmax(0, 1fr))` }}>
                {originalPhotos.map((photo, i) => {
                  const selected = selectedUrls.has(photo.url);
                  return (
                    <div key={`orig-${photo.url}`}
                      className={`break-inside-avoid animate-fade-up group relative rounded-2xl overflow-hidden bg-white card-glow cursor-pointer transition-opacity duration-150 ${
                        selectMode && !selected ? "opacity-60" : ""
                      } ${selected ? "ring-2 ring-orange-400" : ""}`}
                      style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                      onClick={() => {
                        if (selectMode) { toggleSelected(photo.url); return; }
                        reuseOriginalPhoto(photo.url);
                      }}>
                      <img src={photo.url} alt="Original upload" className="w-full h-auto object-cover" />
                      {selectMode && (
                        <div className={`absolute top-2 right-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected ? "bg-orange-500 border-orange-500" : "bg-white/70 border-white backdrop-blur-sm"
                        }`}>
                          {selected && <span className="text-white text-[10px] leading-none">✓</span>}
                        </div>
                      )}
                      {!selectMode && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                          <div className="flex gap-1.5 flex-wrap items-center">
                            <span className="text-xs font-semibold text-white bg-sky-500/90 px-2.5 py-1 rounded-full">
                              ↻ Use this photo
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); downloadImage(photo.url); }}
                              title="Download the original at full size"
                              className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${overlayChip}`}>
                              ↓
                            </button>
                          </div>
                        </div>
                      )}
                      {formatDate(photo.createdAt) && (
                        <div className="absolute bottom-2 right-2 pointer-events-none">
                          <span className="text-[10px] bg-black/50 backdrop-blur-sm text-white/80 px-2 py-0.5 rounded-full font-medium">
                            {formatDate(photo.createdAt)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* VIDEO TAB — Seedance 2.0 animates a still into a clip */}
        {!composeTarget && !editor && activeTab === "video" && (
          <div className="flex-1 flex overflow-hidden animate-fade-in">

            {/* Gallery */}
            <section className="flex-1 overflow-y-auto p-8">
              <div className="mb-6 animate-slide-in-left">
                <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">Video</h2>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {videos.length === 0 && videoJobs.length === 0
                    ? "Bring a Pixar pet to life — pick a photo, describe the motion"
                    : `${videos.length} clip${videos.length === 1 ? "" : "s"}${
                        videoJobs.length ? ` · ${videoJobs.length} generating` : ""
                      }`}
                </p>
              </div>

              {videos.length === 0 && videoJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 gap-4">
                  <div className="animate-float logo-glow">
                    <Image src="/logo.png" alt="Petpho mascot" width={120} height={120} className="w-28 h-28" />
                  </div>
                  <p className="text-base font-semibold text-zinc-700">No videos yet</p>
                  <p className="text-sm text-zinc-600">
                    Choose a first frame on the right and describe what should happen 🎬
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 items-start"
                  style={{ gridTemplateColumns: `repeat(${Math.max(2, galleryColumns - 2)}, minmax(0, 1fr))` }}>
                  {videoJobs.map((job) => (
                    <div key={`vjob-${job.id}`}
                      title={job.error ?? `Generating with ${getVideoModelConfig(job.model).name}…`}
                      onClick={() => { if (job.error) setVideoJobs((jobs) => jobs.filter((j) => j.id !== job.id)); }}
                      className={`relative rounded-2xl overflow-hidden bg-white card-glow ring-2 aspect-video ${
                        job.error ? "ring-red-400 cursor-pointer" : "ring-orange-300/60"
                      }`}>
                      {job.thumbnailUrl && (
                        <img src={job.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-30" />
                      )}
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/[0.03]">
                        {job.error ? (
                          <>
                            <span className="text-red-500 text-2xl font-bold leading-none">!</span>
                            <span className="text-[11px] text-red-500 font-semibold px-4 text-center leading-snug">
                              {job.error}
                            </span>
                            <span className="text-[10px] text-zinc-500">Click to dismiss</span>
                          </>
                        ) : (
                          <>
                            <span className="w-7 h-7 border-2 border-orange-400/40 border-t-orange-400 rounded-full animate-spin" />
                            <span className="text-[11px] font-semibold text-zinc-600">Generating…</span>
                            <span className="text-[10px] text-zinc-500">This takes a few minutes</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {videos.map((video, i) => (
                    <div key={`video-${video.url}`}
                      className="animate-fade-up group relative rounded-2xl overflow-hidden bg-black card-glow"
                      style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}>
                      {/* No autoplay: several clips with audio all starting at
                          once on tab open would be unusable. */}
                      <video src={video.url} controls playsInline preload="metadata"
                        className="w-full h-auto block" />
                      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <button onClick={() => downloadImage(video.url)} title="Download this clip"
                          className={`text-xs w-7 h-7 flex items-center justify-center rounded-full ${overlayChip}`}>
                          ↓
                        </button>
                        <button onClick={() => removeVideo(video.url)} title="Delete this clip"
                          className={`text-xs w-7 h-7 flex items-center justify-center rounded-full ${overlayChip}`}>
                          ✕
                        </button>
                      </div>
                      {(video.prompt || formatDate(video.createdAt)) && (
                        <div className="px-3 py-2 bg-white">
                          {video.prompt && (
                            <p className="text-[11px] text-zinc-600 leading-snug line-clamp-2">{video.prompt}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            {video.model && (
                              <span className="text-[10px] text-zinc-500 font-medium">
                                {getVideoModelConfig(video.model).name}
                              </span>
                            )}
                            {formatDate(video.createdAt) && (
                              <span className="text-[10px] text-zinc-400">{formatDate(video.createdAt)}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Controls — same width as the editor's panel */}
            <div className={`flex flex-col w-[300px] ${floatCard} p-4 gap-5 overflow-y-auto flex-shrink-0 my-6 mr-6`}>
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-zinc-900 text-sm flex-1">New video</span>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>First frame — optional</label>
                <div className="max-h-[26vh] overflow-y-auto pr-0.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setVideoSourceUrl(null)}
                      title="Generate from the prompt alone, with no starting image"
                      className={`relative rounded-lg aspect-square ring-2 flex flex-col items-center justify-center gap-1 transition-all duration-150 ${
                        videoSourceUrl === null
                          ? "ring-orange-400 bg-orange-50"
                          : "ring-transparent bg-black/[0.04] hover:ring-black/15"
                      }`}>
                      <span className="text-lg leading-none">✏️</span>
                      <span className="text-[10px] font-semibold text-zinc-600">Text only</span>
                    </button>
                    {history.map((img, i) => {
                      const active = img.url === videoSourceUrl;
                      return (
                        <button key={`vpick-${img.url}-${i}`}
                          onClick={() => setVideoSourceUrl(img.url)}
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
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Model</label>
                <div className="relative">
                  <select value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value as VideoModelId)}
                    className={selectBox}>
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <Chevron />
                </div>
                <p className="text-[11px] text-zinc-500 leading-snug">
                  {getVideoModelConfig(videoModel).description}
                </p>
              </div>

              <div className="flex gap-2">
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <label className={label}>Length</label>
                  <div className="relative">
                    <select value={videoDuration}
                      onChange={(e) => setVideoDuration(Number(e.target.value))}
                      className={selectBox}>
                      {VIDEO_DURATIONS.map((d) => (
                        <option key={d} value={d}>{d === -1 ? "Auto" : `${d}s`}</option>
                      ))}
                    </select>
                    <Chevron />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <label className={label}>Quality</label>
                  <div className="relative">
                    <select value={videoResolution}
                      onChange={(e) => setVideoResolution(e.target.value)}
                      className={selectBox}>
                      {VIDEO_RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    <Chevron />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={label}>Shape</label>
                <div className="relative">
                  <select value={videoAspect}
                    onChange={(e) => setVideoAspect(e.target.value)}
                    className={selectBox}>
                    {VIDEO_ASPECT_RATIOS.map((r) => (
                      <option key={r} value={r}>{r === "adaptive" ? "Match first frame" : r}</option>
                    ))}
                  </select>
                  <Chevron />
                </div>
              </div>

              <button
                onClick={() => setVideoAudio((v) => !v)}
                title="Seedance can generate synchronised sound effects, music and dialogue"
                className={`w-full py-2 rounded-full text-xs font-bold border transition-all duration-200 ${
                  videoAudio ? chipOn : chipOff
                }`}>
                {videoAudio ? "🔊 Audio on" : "🔇 Audio off"}
              </button>

              <div className="border-t border-black/[0.05] pt-4 flex flex-col gap-2">
                <label className={label}>Prompt</label>
                {videoError && <p className={errorBox}>{videoError}</p>}
                <div className="relative">
                  <textarea value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleGenerateVideo(); } }}
                    placeholder="Describe the motion — e.g. the puppy trots toward the camera, tail wagging…"
                    rows={4}
                    className="w-full bg-black/[0.035] rounded-xl text-sm p-3 pr-9 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/20 placeholder-zinc-500 text-zinc-900" />
                  <button
                    type="button"
                    onClick={() => toggleDictation(
                      (t) => setVideoPrompt((p) => (p ? `${p} ${t}` : t)),
                      () => setVideoError("Voice input isn't supported in this browser — try Chrome"),
                    )}
                    title={listening ? "Stop listening" : "Dictate your prompt"}
                    className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 ${
                      listening
                        ? "bg-red-500 text-white animate-pulse"
                        : "bg-black/[0.05] text-zinc-500 hover:text-zinc-800"
                    }`}>
                    <MicIcon />
                  </button>
                </div>
                {videoAudio && (
                  <p className="text-[11px] text-zinc-500 leading-snug">
                    Put spoken lines in &quot;double quotes&quot; and they&apos;ll be voiced.
                  </p>
                )}
                <button onClick={handleGenerateVideo} disabled={!videoPrompt.trim()}
                  title="Runs in the background — you can queue another straight away"
                  className="btn-primary w-full py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center gap-2">
                  🎬 Generate Video
                </button>
              </div>
            </div>
          </div>
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
                key={composeTarget.url}
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
