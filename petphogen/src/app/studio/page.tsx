"use client";

import Image from "next/image";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { MODELS, DEFAULT_MODEL, COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, type ModelId, type ModelConfig } from "@/lib/models";
import { PREMADE_BACKGROUNDS } from "@/lib/premadeBackgrounds";

const ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
];

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

const label = "text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.14em]";
const inputDark =
  "w-full bg-black/[0.035] dark:bg-white/[0.045] border border-transparent rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:ring-2 focus:ring-orange-400/20 transition-all duration-200";
const chipOff =
  "bg-black/[0.035] dark:bg-white/[0.04] border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.07] hover:text-zinc-800 dark:hover:text-zinc-200";
const chipOn = "bg-orange-500 border-orange-500 text-white shadow-sm shadow-orange-500/25";
const floatCard =
  "bg-white dark:bg-[#19191c] rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_10px_28px_rgba(0,0,0,0.45)]";

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
                : "bg-black/[0.03] dark:bg-white/[0.035] text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
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

const MODEL_BADGE: Record<string, string> = {
  "black-forest-labs/flux-kontext-pro": "bg-violet-500/20 text-violet-300",
  "stability-ai/stable-diffusion-3.5-large": "bg-blue-500/20 text-blue-300",
  "ideogram-ai/ideogram-v2-turbo": "bg-emerald-500/20 text-emerald-300",
  "google/nano-banana": "bg-amber-500/20 text-amber-300",
  "qwen/qwen-image-edit-plus": "bg-indigo-500/20 text-indigo-300",
  "bytedance/seedream-4": "bg-pink-500/20 text-pink-300",
};

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
}) {
  const modelName = MODELS.find((m) => m.id === img.model)?.name ?? img.model.split("/")[1];
  const badgeClass = MODEL_BADGE[img.model] ?? "bg-white/10 text-zinc-700 dark:text-zinc-300";
  return (
    <div className="break-inside-avoid animate-fade-up" style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}>
      <div
        className={`group relative rounded-2xl overflow-hidden bg-white dark:bg-[#18181b] ${
          isBroken ? "cursor-default" : "card-glow cursor-pointer"
        }`}
        onClick={() => !isBroken && onOpen()}
      >
        {isBroken ? (
          <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4">
            <span className="text-3xl opacity-30">🖼️</span>
            <p className="text-xs text-zinc-500 font-medium">Expired</p>
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-xs bg-red-500/15 hover:bg-red-500/30 text-red-400 px-3 py-1 rounded-full transition-colors font-medium mt-1">
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-hidden">
              <Image src={img.url} alt={img.prompt} width={512} height={512}
                className="w-full h-auto object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                unoptimized onError={onBroken} priority={index === 0} />
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
              <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                {img.prompt}
              </p>
              <div className="flex gap-1.5 flex-wrap translate-y-2 group-hover:translate-y-0 transition-transform duration-300 delay-[40ms]">
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="text-xs bg-orange-500/95 hover:bg-orange-400 text-white px-2.5 py-1 rounded-full transition-colors font-semibold">
                  ✏️ Edit
                </button>
                <button onClick={(e) => { e.stopPropagation(); onScene(); }}
                  className="text-xs bg-sky-500/95 hover:bg-sky-400 text-white px-2.5 py-1 rounded-full transition-colors font-semibold">
                  🖼️ Scene
                </button>
                {img.uploadUrl && (
                  <button onClick={(e) => { e.stopPropagation(); onViewOriginal(); }}
                    className="text-xs bg-white/20 hover:bg-white/35 backdrop-blur-sm text-white px-2.5 py-1 rounded-full transition-colors font-semibold">
                    🐾 Original
                  </button>
                )}
                <a href={img.url} download onClick={(e) => e.stopPropagation()}
                  className="text-xs bg-white/20 hover:bg-white/35 backdrop-blur-sm text-white w-6 h-6 flex items-center justify-center rounded-full transition-colors">
                  ↓
                </a>
                <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="text-xs bg-red-500/70 hover:bg-red-500 text-white w-6 h-6 flex items-center justify-center rounded-full transition-colors">
                  🗑️
                </button>
              </div>
            </div>
            {/* Badges */}
            <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
              {img.sourceUrl && (
                <span className="text-[10px] bg-orange-500/90 backdrop-blur-sm text-white px-2 py-0.5 rounded-full font-semibold">
                  Edited
                </span>
              )}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto backdrop-blur-sm ${badgeClass}`}>
                {modelName}
              </span>
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
  const draggingPetRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [composeTarget, setComposeTarget] = useState<GeneratedImage | null>(null);
  const [composeModel, setComposeModel] = useState<ModelId>(DEFAULT_COMPOSE_MODEL);
  const [composeAspectRatio, setComposeAspectRatio] = useState("auto");
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "history">("generate");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<ModelId | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showGenSettings, setShowGenSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numOutputs, setNumOutputs] = useState(1);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
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
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("petpho-theme", next ? "dark" : "light");
    } catch {}
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem("petpho-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (!historyInitialSaveSkipped.current) {
      historyInitialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem("petpho-history", JSON.stringify(history));
  }, [history]);

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
      setBackgroundPhoto(null);
      setBackgroundPhotoPreview(null);
      setSelectedPremadeBg(null);
      setBgAspect(null);
      setPetPos({ x: 50, y: 65 });
      setPetScale(35);
      setComposeAspectRatio("auto");
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

  const sidebarActive = composeTarget || editor ? "history" : activeTab;

  function navTo(tab: "generate" | "history") {
    setEditor(null);
    setComposeTarget(null);
    setBackgroundPhoto(null);
    setBackgroundPhotoPreview(null);
    setComposeError(null);
    setActiveTab(tab);
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

  const errorBox = "text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 animate-fade-in";

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f6f7] dark:bg-[#0f0f11] text-zinc-800 dark:text-zinc-200">

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <nav className="w-[212px] flex-shrink-0 flex flex-col bg-white dark:bg-[#141416]">
        <div className="px-4 pt-6 pb-5 flex items-center gap-2.5 group/brand">
          <Image src="/logo.png" alt="Petpho mascot" width={40} height={40}
            className="w-10 h-10 flex-shrink-0 transition-transform duration-300 group-hover/brand:scale-110 group-hover/brand:-rotate-6" />
          <div className="min-w-0">
            <p className="text-zinc-900 dark:text-white font-bold text-sm tracking-tight leading-tight">Petpho</p>
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
                    ? "bg-black/[0.055] dark:bg-white/[0.07] text-zinc-900 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
              >
                <span className="text-[15px] leading-none transition-transform duration-200 group-hover:scale-110">
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium flex-1">{item.name}</span>
                {item.id === "history" && history.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-colors duration-200 ${
                    active ? "bg-orange-400/15 text-orange-500 dark:text-orange-300" : "bg-black/[0.05] dark:bg-white/[0.06] text-zinc-500"
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
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2 rounded-xl w-full text-left text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-all duration-200"
          >
            <span className="text-[15px] leading-none">{isDark ? "🌙" : "☀️"}</span>
            <span className="text-[13px] font-medium">{isDark ? "Dark" : "Light"}</span>
          </button>
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 rounded-xl w-full text-left text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/[0.06] transition-all duration-200"
          >
            <span className="text-[15px] leading-none">🚪</span>
            <span className="text-[13px] font-medium">Sign out</span>
          </button>
        </div>

        <div className="px-4 py-3.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold uppercase tracking-[0.14em]">Admin</span>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* COMPOSE VIEW */}
        {composeTarget && (
          <div className="flex-1 flex overflow-hidden animate-fade-in">
            <aside className={`w-[300px] ${floatCard} flex flex-col gap-5 p-5 overflow-y-auto flex-shrink-0 m-6 mr-3`}>
              <div className="flex items-center gap-3 pb-1">
                <button
                  onClick={() => { setComposeTarget(null); setBackgroundPhoto(null); setBackgroundPhotoPreview(null); setSelectedPremadeBg(null); setBgAspect(null); setComposeError(null); }}
                  className="w-7 h-7 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all flex items-center justify-center text-sm"
                >
                  ←
                </button>
                <span className="font-bold text-zinc-900 dark:text-white text-sm">Place in Scene</span>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Your Pixar Pet</label>
                <div className="rounded-2xl overflow-hidden ring-1 ring-black/[0.08] dark:ring-white/[0.1]">
                  <img src={composeTarget.url} alt="Pixar pet" className="w-full h-40 object-cover" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className={label}>Background Photo</label>
                  <div className="flex rounded-full bg-black/[0.035] dark:bg-white/[0.04] p-0.5 text-[11px] font-semibold">
                    <button onClick={() => setBgSourceTab("premade")}
                      className={`px-2.5 py-1 rounded-md transition-all duration-200 ${
                        bgSourceTab === "premade" ? "bg-sky-500 text-white" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      }`}>
                      Premade
                    </button>
                    <button onClick={() => setBgSourceTab("upload")}
                      className={`px-2.5 py-1 rounded-md transition-all duration-200 ${
                        bgSourceTab === "upload" ? "bg-sky-500 text-white" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      }`}>
                      Upload
                    </button>
                  </div>
                </div>

                {bgSourceTab === "premade" ? (
                  PREMADE_BACKGROUNDS.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {PREMADE_BACKGROUNDS.map((bg) => (
                        <button key={bg.id} onClick={() => selectPremadeBackground(bg)}
                          title={bg.name}
                          className={`relative rounded-lg overflow-hidden aspect-square ring-2 transition-all duration-200 ${
                            selectedPremadeBg === bg.id ? "ring-orange-400" : "ring-black/[0.08] dark:ring-white/[0.08] hover:ring-black/[0.3] dark:hover:ring-white/[0.3]"
                          }`}>
                          <img src={bg.file} alt={bg.name} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed border-black/[0.1] dark:border-white/[0.1] bg-black/[0.02] dark:bg-white/[0.02] py-6 px-3 text-center">
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
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Upload a background</p>
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

              {backgroundPhotoPreview && (
                <div className="flex flex-col gap-2">
                  <label className={label}>
                    Pet Size — <span className="text-orange-400">{petScale}%</span>
                  </label>
                  <input type="range" min={10} max={80} value={petScale}
                    onChange={(e) => setPetScale(Number(e.target.value))}
                    className="w-full" />
                  <p className="text-xs text-zinc-600">Drag the pet in the preview to position it</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className={label}>Output Aspect Ratio</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setComposeAspectRatio("auto")}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                      composeAspectRatio === "auto" ? chipOn : chipOff
                    }`}>
                    Auto
                  </button>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r.value} onClick={() => setComposeAspectRatio(r.value)}
                      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                        composeAspectRatio === r.value ? chipOn : chipOff
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600">Auto matches your background photo&apos;s shape</p>
              </div>

              <ModelSwitcher value={composeModel} onChange={setComposeModel} models={COMPOSE_MODELS} title="Compose Model" />

              {composeError && <p className={errorBox}>{composeError}</p>}

              <button
                onClick={handleCompose}
                disabled={composeLoading || !backgroundPhoto}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg shadow-sky-500/25 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-white flex items-center justify-center gap-2"
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
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Placing your pet in the scene...</p>
                </div>
              ) : backgroundPhotoPreview ? (
                <div className="flex flex-col items-center gap-3 animate-scale-in w-full">
                  <div
                    ref={stageRef}
                    className="relative rounded-2xl overflow-hidden ring-1 ring-black/[0.1] dark:ring-white/[0.1] shadow-2xl shadow-black/50 select-none bg-black/20"
                    style={{ aspectRatio: bgAspect ? `${bgAspect}` : "16/9", width: "100%", maxWidth: 640 }}
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
                    <img
                      src={composeTarget.url}
                      alt="Pixar pet"
                      draggable={false}
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
                      className="absolute cursor-grab active:cursor-grabbing drop-shadow-2xl ring-2 ring-orange-400/70 rounded-lg"
                      style={{
                        left: `${petPos.x}%`,
                        top: `${petPos.y}%`,
                        width: `${petScale}%`,
                        height: "auto",
                        transform: "translate(-50%, -50%)",
                        touchAction: "none",
                      }}
                    />
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] bg-black/60 backdrop-blur-sm text-white/80 px-3 py-1 rounded-full font-medium pointer-events-none">
                      Drag the pet to position it
                    </div>
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

            {/* Left panel: source + results */}
            <div className={`flex flex-col w-[236px] ${floatCard} p-4 gap-4 overflow-y-auto flex-shrink-0 my-6 ml-6`}>
              <div className="flex items-center gap-3 pb-1">
                <button onClick={() => setEditor(null)}
                  className="w-7 h-7 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.1] dark:hover:bg-white/[0.12] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all flex items-center justify-center text-sm">
                  ←
                </button>
                <span className="font-bold text-zinc-900 dark:text-white text-sm">Editor</span>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Source</label>
                <div className="rounded-2xl overflow-hidden ring-1 ring-orange-400/30">
                  <Image src={editor.sourceImage.url} alt="Source" width={320} height={320} className="w-full h-auto object-cover" unoptimized />
                </div>
                <p className="text-xs text-zinc-500 italic line-clamp-2">&ldquo;{editor.sourceImage.prompt}&rdquo;</p>
              </div>

              <div className="border-t border-black/[0.05] dark:border-white/[0.06] pt-4 flex flex-col gap-2">
                <label className={label}>Results{editor.results.length > 0 ? ` — ${editor.results.length}` : ""}</label>
                {editor.loading && <div className="rounded-2xl skeleton w-full" style={{ aspectRatio: "1/1" }} />}
                {editor.results.length === 0 && !editor.loading ? (
                  <p className="text-xs text-zinc-500 leading-relaxed">Brush over the image, describe the change, and results appear here</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {editor.results.map((img, i) => (
                      <div key={`${img.url}-${i}`}
                        className="group relative rounded-2xl overflow-hidden bg-white dark:bg-[#18181b] card-glow cursor-pointer animate-scale-in"
                        onClick={() => setLightbox(img.url)}>
                        <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105" unoptimized />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2.5 gap-1.5">
                          <div className="flex gap-1.5 flex-wrap">
                            <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className="text-[11px] bg-orange-500/95 hover:bg-orange-400 text-white px-2 py-0.5 rounded-full transition-colors font-medium">Edit this</button>
                            <a href={img.url} download onClick={(e) => e.stopPropagation()} className="text-[11px] bg-white/20 hover:bg-white/35 backdrop-blur-sm text-white px-2 py-0.5 rounded-full transition-colors">↓</a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                    className="flex-1 bg-transparent text-sm py-2.5 resize-none focus:outline-none placeholder-zinc-500 text-zinc-900 dark:text-zinc-100" />
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
                        : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
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

        {/* MAIN VIEW */}
        {!composeTarget && !editor && (
          <div className="flex-1 flex overflow-hidden">

            {/* ── CREATE TAB ─────────────────────────────────── */}
            {activeTab === "generate" && (
              <div className="flex-1 flex flex-col overflow-hidden animate-fade-in relative">
                <section className="flex-1 overflow-y-auto px-6 pt-6 pb-44">
                  {history.length === 0 && !loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                      <div className="animate-float logo-glow">
                        <Image src="/logo.png" alt="Petpho mascot" width={160} height={160} className="w-36 h-36" priority />
                      </div>
                      <p className="text-base font-semibold text-zinc-700 dark:text-zinc-300">Your Pixar pet portraits will appear here</p>
                      <p className="text-sm text-zinc-600">Upload a photo and hit Generate ✨</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
                          onScene={() => setComposeTarget(img)}
                          onRemove={() => removeFromHistory(img.url)}
                          onViewOriginal={() => img.uploadUrl && setLightbox(img.uploadUrl)}
                        />
                      ))}
                    </div>
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
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">⌘ + Enter to generate</p>
                    </div>
                  )}

                  {(!photo || error) && (
                    <div className="flex justify-center">
                      {error
                        ? <div className={errorBox}>{error}</div>
                        : <p className="text-xs text-zinc-500 bg-white/70 dark:bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full">Upload a pet photo to get started</p>}
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
                            : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-500 hover:bg-black/[0.08] dark:hover:bg-white/[0.1] hover:text-zinc-800 dark:hover:text-zinc-200"
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
                      className="flex-1 bg-transparent text-sm px-2 py-2.5 resize-none focus:outline-none placeholder-zinc-500 text-zinc-900 dark:text-zinc-100" />

                    <button
                      type="button"
                      onClick={() => setShowGenSettings((v) => !v)}
                      title="Model, aspect ratio & more"
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                        showGenSettings
                          ? "bg-orange-500 text-white"
                          : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
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
                          : "bg-black/[0.04] dark:bg-white/[0.06] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
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
            )}

            {/* ── EDIT TAB ────────────────────────────────────── */}
            {activeTab === "history" && (
              <section className="flex-1 overflow-y-auto p-8 animate-fade-in">
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div className="animate-slide-in-left">
                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Edit</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">
                      {history.length} image{history.length !== 1 ? "s" : ""} generated
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">🔍</span>
                      <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search prompts..."
                        className="pl-8 pr-4 py-2 text-sm bg-black/[0.035] dark:bg-white/[0.045] border border-transparent rounded-full text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none focus:bg-white dark:focus:bg-white/[0.06] focus:ring-2 focus:ring-orange-400/20 w-52 transition-all duration-200" />
                    </div>
                    {history.length > 0 && (
                      <button onClick={() => { if (confirm("Clear all history?")) setHistory([]); }}
                        className="text-xs text-red-400/70 hover:text-red-400 transition-colors font-medium px-3 py-2 rounded-full hover:bg-red-500/10">
                        Clear all
                      </button>
                    )}
                  </div>
                </div>

                {history.length > 0 && (
                  <div className="flex gap-2 mb-6 flex-wrap">
                    <button onClick={() => setHistoryFilter(null)}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all duration-200 ${
                        historyFilter === null
                          ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-black"
                          : "bg-black/[0.035] dark:bg-white/[0.04] text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
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
                              : "bg-black/[0.035] dark:bg-white/[0.04] text-zinc-600 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-orange-300"
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
                    <p className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
                      {history.length === 0 ? "No images yet" : "No results found"}
                    </p>
                    <p className="text-sm text-zinc-600">
                      {history.length === 0 ? "Generate your first Pixar pet portrait" : "Try a different search or filter"}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredHistory.map((img, i) => (
                      <ImageCard
                        key={`hist-${img.url}-${i}`}
                        img={img}
                        index={i}
                        showDate
                        isBroken={brokenImages.has(img.url)}
                        onBroken={() => markBroken(img.url)}
                        onOpen={() => setLightbox(img.url)}
                        onEdit={() => openEditor(img)}
                        onScene={() => setComposeTarget(img)}
                        onRemove={() => removeFromHistory(img.url)}
                        onViewOriginal={() => img.uploadUrl && setLightbox(img.uploadUrl)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-8 animate-fade-in"
          onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl bg-black/[0.06] dark:bg-white/[0.06] hover:bg-black/[0.15] dark:hover:bg-white/[0.15] w-10 h-10 rounded-full flex items-center justify-center transition-all"
            onClick={() => setLightbox(null)}>
            ✕
          </button>
          <Image src={lightbox} alt="Preview" width={1024} height={1024}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl animate-scale-in"
            unoptimized priority onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
