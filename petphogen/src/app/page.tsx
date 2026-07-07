"use client";

import Image from "next/image";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { MODELS, DEFAULT_MODEL, COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, type ModelId, type ModelConfig } from "@/lib/models";
import { BACKGROUNDS } from "@/lib/backgrounds";

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
  createdAt?: number;
};

type EditorState = {
  sourceImage: GeneratedImage;
  editPrompt: string;
  selectedBackground: string | null;
  numOutputs: number;
  aspectRatio: string;
  model: ModelId;
  loading: boolean;
  error: string | null;
  results: GeneratedImage[];
  mode: "text" | "brush";
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
    <div className="relative select-none rounded-xl overflow-hidden ring-1 ring-orange-400/40 shadow-2xl shadow-black/40">
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
  "w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-orange-400/60 focus:ring-2 focus:ring-orange-400/15 transition-all duration-200";
const chipOff =
  "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200 hover:border-white/[0.14]";
const chipOn = "bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-500/25";

function ModelSwitcher({
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
      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <button key={m.id} onClick={() => onChange(m.id)}
            className={`text-left rounded-xl border px-3 py-2.5 transition-all duration-200 ${
              value === m.id
                ? "bg-gradient-to-r from-orange-500 to-amber-500 border-transparent text-white shadow-lg shadow-orange-500/20"
                : "bg-white/[0.03] border-white/[0.07] text-zinc-300 hover:bg-white/[0.06] hover:border-white/[0.14]"
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

function BackgroundPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className={label}>
        Background <span className="text-zinc-600 normal-case font-normal tracking-normal">(optional)</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onChange(null)}
          className={`col-span-2 text-xs px-3 py-2 rounded-xl border font-medium transition-all duration-200 ${
            value === null ? chipOn : chipOff
          }`}>
          ✕ No Background
        </button>
        {BACKGROUNDS.map((bg) => (
          <button key={bg.id} onClick={() => onChange(value === bg.id ? null : bg.id)}
            className={`flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200 text-left ${
              value === bg.id ? "border-orange-400 shadow-lg shadow-orange-500/15" : "border-white/[0.07] hover:border-white/[0.2]"
            }`}>
            <div className="h-16 overflow-hidden" style={{ background: bg.gradient }} />
            <p className="text-xs font-medium text-zinc-300 py-1.5 px-2 leading-tight bg-[#17171a]">{bg.name}</p>
          </button>
        ))}
      </div>
    </div>
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
  img, index, onOpen, onEdit, onScene, onRemove, isBroken, onBroken, showDate,
}: {
  img: GeneratedImage;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onScene: () => void;
  onRemove: () => void;
  isBroken: boolean;
  onBroken: () => void;
  showDate?: boolean;
}) {
  const modelName = MODELS.find((m) => m.id === img.model)?.name ?? img.model.split("/")[1];
  const badgeClass = MODEL_BADGE[img.model] ?? "bg-white/10 text-zinc-300";
  return (
    <div className="break-inside-avoid animate-fade-up" style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}>
      <div
        className={`group relative rounded-xl overflow-hidden bg-[#131316] ring-1 ring-white/[0.06] ${
          isBroken ? "cursor-default" : "card-glow cursor-pointer"
        }`}
        onClick={() => !isBroken && onOpen()}
      >
        {isBroken ? (
          <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4">
            <span className="text-3xl opacity-30">🖼️</span>
            <p className="text-xs text-zinc-500 font-medium">Expired</p>
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-xs bg-red-500/15 hover:bg-red-500/30 text-red-400 px-3 py-1 rounded-lg transition-colors font-medium mt-1">
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-hidden">
              <Image src={img.url} alt={img.prompt} width={512} height={512}
                className="w-full h-auto object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                unoptimized onError={onBroken} />
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
              <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                {img.prompt}
              </p>
              <div className="flex gap-1.5 flex-wrap translate-y-2 group-hover:translate-y-0 transition-transform duration-300 delay-[40ms]">
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">
                  ✏️ Edit
                </button>
                <button onClick={(e) => { e.stopPropagation(); onScene(); }}
                  className="text-xs bg-sky-500 hover:bg-sky-400 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">
                  🖼️ Scene
                </button>
                <a href={img.url} download onClick={(e) => e.stopPropagation()}
                  className="text-xs bg-white/15 hover:bg-white/30 backdrop-blur-sm text-white px-2.5 py-1 rounded-lg transition-colors">
                  ↓
                </a>
                <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="text-xs bg-red-500/60 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg transition-colors">
                  🗑️
                </button>
              </div>
            </div>
            {/* Badges */}
            <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
              {img.sourceUrl && (
                <span className="text-[10px] bg-orange-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded-md font-semibold">
                  Edited
                </span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ml-auto backdrop-blur-sm ${badgeClass}`}>
                {modelName}
              </span>
            </div>
            {showDate && formatDate(img.createdAt) && (
              <div className="absolute bottom-2 right-2 pointer-events-none">
                <span className="text-[10px] bg-black/50 backdrop-blur-sm text-white/80 px-1.5 py-0.5 rounded-md font-medium">
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
        body: JSON.stringify({ imageUrl: editor.sourceImage.url, maskDataUrl, prompt: editor.editPrompt }),
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
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: prompt || "Pixar style", model, createdAt: now,
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
      sourceImage: img, editPrompt: "", selectedBackground: null,
      numOutputs: 1, aspectRatio: "1:1", model: img.model,
      loading: false, error: null, results: [], mode: "text",
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

  async function handleApplyEdit() {
    if (!editor || (!editor.editPrompt.trim() && !editor.selectedBackground)) return;
    setEditor((e) => e && { ...e, loading: true, error: null });
    try {
      const bgConfig = editor.selectedBackground
        ? (BACKGROUNDS.find((b) => b.id === editor.selectedBackground) ?? null)
        : null;
      const combinedPrompt = [
        editor.editPrompt.trim(),
        bgConfig ? `set the background to ${bgConfig.description}` : null,
      ].filter(Boolean).join(", also ");

      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: editor.sourceImage.url, editPrompt: combinedPrompt,
          aspectRatio: editor.aspectRatio, numOutputs: editor.numOutputs, model: editor.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Edit failed");
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url, prompt: editor.editPrompt, model: editor.model, sourceUrl: editor.sourceImage.url,
      }));
      setHistory((prev) => [...newImages, ...prev]);
      setEditor((e) => e && { ...e, results: [...newImages, ...e.results], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setEditor((e) => e && { ...e, error: msg, loading: false });
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

  function markBroken(url: string) {
    setBrokenImages((prev) => new Set(prev).add(url));
  }

  function removeFromHistory(url: string) {
    setHistory((h) => h.filter((x) => x.url !== url));
  }

  const errorBox = "text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 animate-fade-in";

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0c] text-zinc-200">

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <nav className="w-[200px] flex-shrink-0 flex flex-col bg-[#101012] border-r border-white/[0.05]">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-base shadow-lg shadow-orange-500/25 flex-shrink-0">
            🐶
          </div>
          <div className="min-w-0">
            <p className="text-white font-extrabold text-sm tracking-tight leading-tight">PETPHO</p>
            <p className="text-orange-400 text-[11px] font-semibold leading-tight">Gen</p>
          </div>
        </div>

        <div className="mx-3 h-px bg-white/[0.05] mb-3" />

        <div className="px-2 flex flex-col gap-1">
          {([
            { id: "generate" as const, icon: "✨", name: "Create" },
            { id: "history" as const, icon: "🎨", name: "Edit" },
          ]).map((item) => {
            const active = sidebarActive === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navTo(item.id)}
                className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl w-full text-left transition-all duration-200 ${
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-orange-400 to-amber-500 animate-slide-in-left" />
                )}
                <span className="text-base leading-none transition-transform duration-200 group-hover:scale-110">
                  {item.icon}
                </span>
                <span className="text-sm font-medium flex-1">{item.name}</span>
                {item.id === "history" && history.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-colors duration-200 ${
                    active ? "bg-orange-400/20 text-orange-300" : "bg-white/[0.06] text-zinc-600"
                  }`}>
                    {history.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <div className="px-4 py-4 border-t border-white/[0.05] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-[0.14em]">Admin</span>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* COMPOSE VIEW */}
        {composeTarget && (
          <div className="flex-1 flex overflow-hidden animate-fade-in">
            <aside className="w-[300px] bg-[#111114] border-r border-white/[0.06] flex flex-col gap-5 p-5 overflow-y-auto flex-shrink-0">
              <div className="flex items-center gap-3 pb-1">
                <button
                  onClick={() => { setComposeTarget(null); setBackgroundPhoto(null); setBackgroundPhotoPreview(null); setBgAspect(null); setComposeError(null); }}
                  className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-all flex items-center justify-center text-sm"
                >
                  ←
                </button>
                <span className="font-bold text-white text-sm">Place in Scene</span>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Your Pixar Pet</label>
                <div className="rounded-xl overflow-hidden ring-1 ring-white/[0.1]">
                  <img src={composeTarget.url} alt="Pixar pet" className="w-full h-40 object-cover" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className={label}>Background Photo</label>
                {backgroundPhotoPreview ? (
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
                    <p className="text-sm font-medium text-zinc-300">Upload a background</p>
                    <p className="text-xs text-zinc-600">Drag your pet into place after</p>
                  </div>
                )}
                <input ref={bgFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBackgroundPhoto(file);
                    setBackgroundPhotoPreview(URL.createObjectURL(file));
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
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all duration-200 ${
                      composeAspectRatio === "auto" ? chipOn : chipOff
                    }`}>
                    Auto
                  </button>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r.value} onClick={() => setComposeAspectRatio(r.value)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all duration-200 ${
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
                  <p className="text-sm text-zinc-400">Placing your pet in the scene...</p>
                </div>
              ) : backgroundPhotoPreview ? (
                <div className="flex flex-col items-center gap-3 animate-scale-in w-full">
                  <div
                    ref={stageRef}
                    className="relative rounded-2xl overflow-hidden ring-1 ring-white/[0.1] shadow-2xl shadow-black/50 select-none bg-black/20"
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
            <div className="flex flex-col w-[280px] bg-[#111114] border-r border-white/[0.06] p-5 gap-4 overflow-y-auto flex-shrink-0">
              <div className="flex items-center gap-3 pb-1">
                <button onClick={() => setEditor(null)}
                  className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] text-zinc-400 hover:text-white transition-all flex items-center justify-center text-sm">
                  ←
                </button>
                <span className="font-bold text-white text-sm">Image Editor</span>
              </div>

              <div className="rounded-xl overflow-hidden ring-1 ring-orange-400/40 shadow-lg shadow-black/30">
                <Image src={editor.sourceImage.url} alt="Source" width={320} height={320} className="w-full h-auto object-cover" unoptimized />
              </div>
              <p className="text-xs text-zinc-500 italic line-clamp-2">&ldquo;{editor.sourceImage.prompt}&rdquo;</p>

              {/* Mode switcher */}
              <div className="flex rounded-xl bg-white/[0.04] border border-white/[0.07] p-1 text-xs font-bold">
                {(["text", "brush"] as const).map((m) => (
                  <button key={m} onClick={() => setEditor((e) => e && { ...e, mode: m })}
                    className={`flex-1 py-2 rounded-lg transition-all duration-200 ${
                      editor.mode === m
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}>
                    {m === "text" ? "✏️ Text" : "🖌️ Brush"}
                  </button>
                ))}
              </div>

              <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-4">
                {editor.mode === "text" ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className={label}>Edit Prompt</label>
                      <textarea value={editor.editPrompt}
                        onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleApplyEdit(); } }}
                        placeholder="Add a party hat, change background to beach..."
                        rows={4} className={inputDark} />
                      <p className="text-xs text-zinc-600">⌘ + Enter to apply</p>
                    </div>
                    <ModelSwitcher value={editor.model} onChange={(id) => setEditor((ed) => ed && { ...ed, model: id })} />
                    <BackgroundPicker value={editor.selectedBackground} onChange={(id) => setEditor((ed) => ed && { ...ed, selectedBackground: id })} />
                    <div className="flex flex-col gap-2">
                      <label className={label}>Aspect Ratio</label>
                      <div className="flex flex-wrap gap-2">
                        {ASPECT_RATIOS.map((r) => (
                          <button key={r.value} onClick={() => setEditor((ed) => ed && { ...ed, aspectRatio: r.value })}
                            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all duration-200 ${
                              editor.aspectRatio === r.value ? chipOn : chipOff
                            }`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className={label}>
                        Variants — <span className="text-orange-400">{editor.numOutputs}</span>
                      </label>
                      <input type="range" min={1} max={4} value={editor.numOutputs}
                        onChange={(e) => setEditor((ed) => ed && { ...ed, numOutputs: Number(e.target.value) })}
                        className="w-full" />
                      <div className="flex justify-between text-xs text-zinc-600"><span>1</span><span>4</span></div>
                    </div>
                    <button onClick={handleApplyEdit} disabled={editor.loading || (!editor.editPrompt.trim() && !editor.selectedBackground)}
                      className="btn-primary w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {editor.loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Applying...</>) : <>✏️ Apply Edit</>}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <label className={label}>
                        Zoom — <span className="text-orange-400">{Math.round(canvasZoom * 100)}%</span>
                      </label>
                      <input type="range" min={50} max={300} step={10} value={canvasZoom * 100} onChange={(e) => setCanvasZoom(Number(e.target.value) / 100)} className="w-full" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className={label}>
                        Brush — <span className="text-orange-400">{brushSize}px</span>
                      </label>
                      <input type="range" min={5} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setBrushTool("brush")}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all duration-200 ${brushTool === "brush" ? chipOn : chipOff}`}>
                        🖌️ Brush
                      </button>
                      <button onClick={() => setBrushTool("eraser")}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all duration-200 ${brushTool === "eraser" ? chipOn : chipOff}`}>
                        ⬜ Eraser
                      </button>
                      <button onClick={() => inpaintCanvasRef.current?.clear()}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all duration-200 ${chipOff}`}>
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className={label}>What to Change</label>
                      <textarea value={editor.editPrompt}
                        onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                        placeholder="Describe what to put in the brushed area..."
                        rows={3} className={inputDark} />
                    </div>
                    <button onClick={handleApplyInpaint} disabled={editor.loading || !editor.editPrompt.trim()}
                      className="btn-primary w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {editor.loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Inpainting...</>) : <>🖌️ Apply Inpaint</>}
                    </button>
                  </>
                )}
                {editor.error && <div className={errorBox}>{editor.error}</div>}
              </div>
            </div>

            <section className="flex-1 overflow-y-auto p-6">
              {editor.mode === "brush" ? (
                <div className="flex flex-col gap-6">
                  <div className="overflow-auto">
                    <div style={{ transform: `scale(${canvasZoom})`, transformOrigin: "top left", display: "inline-block", width: `${100 / canvasZoom}%` }}>
                      <InpaintCanvas key={editor.sourceImage.url} ref={inpaintCanvasRef} imageUrl={editor.sourceImage.url} brushSize={brushSize} tool={brushTool} />
                    </div>
                  </div>
                  {editor.loading && <div className="rounded-xl skeleton" style={{ aspectRatio: "1/1", maxWidth: 420 }} />}
                  {editor.results.length > 0 && (
                    <div>
                      <p className={`${label} mb-3 block`}>Inpaint Results</p>
                      <div className="flex flex-wrap gap-3">
                        {editor.results.map((img, i) => (
                          <div key={`${img.url}-${i}`}
                            className="group relative rounded-xl overflow-hidden ring-1 ring-white/[0.08] card-glow cursor-pointer w-64 animate-scale-in"
                            onClick={() => setLightbox(img.url)}>
                            <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105" unoptimized />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
                              <p className="text-xs text-white/90 line-clamp-2 font-medium">{img.prompt}</p>
                              <div className="flex gap-2">
                                <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-2 py-1 rounded-lg transition-colors font-medium">Edit this</button>
                                <a href={img.url} download onClick={(e) => e.stopPropagation()} className="text-xs bg-white/15 hover:bg-white/30 text-white px-2 py-1 rounded-lg transition-colors">Download</a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : editor.results.length === 0 && !editor.loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-600">
                  <div className="text-6xl animate-float">✏️</div>
                  <p className="text-base font-medium text-zinc-400">Describe your edit and hit Apply</p>
                  <p className="text-sm text-zinc-600">Each edit builds on the source image</p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {editor.loading && (
                    <div className="flex gap-3">
                      {Array.from({ length: editor.numOutputs }).map((_, i) => (
                        <div key={`sk-${i}`} className="flex-1 rounded-xl skeleton" style={{ aspectRatio: editor.aspectRatio.replace(":", "/") }} />
                      ))}
                    </div>
                  )}
                  {editor.results.length > 0 && (
                    <div>
                      <p className={`${label} mb-3 block`}>Edit Results</p>
                      <div className="flex flex-wrap gap-3">
                        {editor.results.map((img, i) => (
                          <div key={`${img.url}-${i}`}
                            className="group relative rounded-xl overflow-hidden ring-1 ring-white/[0.08] card-glow cursor-pointer w-64 animate-scale-in"
                            onClick={() => setLightbox(img.url)}>
                            <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105" unoptimized />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 gap-2">
                              <p className="text-xs text-white/90 line-clamp-2 font-medium">{img.prompt}</p>
                              <div className="flex gap-2">
                                <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-2 py-1 rounded-lg transition-colors font-medium">Edit this</button>
                                <a href={img.url} download onClick={(e) => e.stopPropagation()} className="text-xs bg-white/15 hover:bg-white/30 text-white px-2 py-1 rounded-lg transition-colors">Download</a>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {/* MAIN VIEW */}
        {!composeTarget && !editor && (
          <div className="flex-1 flex overflow-hidden">

            {/* ── CREATE TAB ─────────────────────────────────── */}
            {activeTab === "generate" && (
              <div className="flex-1 flex overflow-hidden animate-fade-in">
                <aside className="w-[272px] bg-[#111114] border-r border-white/[0.06] flex flex-col gap-5 p-5 overflow-y-auto flex-shrink-0">
                  <div className="flex flex-col gap-2">
                    <label className={label}>Pet Photo</label>
                    {photoPreview ? (
                      <div className="flex flex-col gap-2 animate-scale-in">
                        <div className="relative rounded-xl overflow-hidden ring-2 ring-orange-400/50 bg-white flex items-center justify-center w-full transition-all duration-300"
                          style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
                          <img src={photoPreview} alt="Uploaded pet"
                            className="transition-all duration-200"
                            style={{ width: `${photoZoom * 100}%`, height: `${photoZoom * 100}%`, objectFit: "contain" }} />
                          <button onClick={() => { setPhoto(null); setPhotoPreview(null); setPhotoZoom(1); }}
                            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg transition-colors">
                            Change
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className={label}>
                            Dog Scale — <span className="text-orange-400">{Math.round(photoZoom * 100)}%</span>
                          </label>
                          <input type="range" min={20} max={100} value={photoZoom * 100}
                            onChange={(e) => setPhotoZoom(Number(e.target.value) / 100)}
                            className="w-full" />
                          <div className="flex justify-between text-xs text-zinc-600"><span>Zoomed out</span><span>Full size</span></div>
                        </div>
                      </div>
                    ) : (
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`cursor-pointer flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 transition-all duration-200 ${
                          dragging
                            ? "border-orange-400 bg-orange-400/[0.12] scale-[1.02]"
                            : "border-white/[0.12] bg-white/[0.02] hover:border-orange-400/60 hover:bg-orange-400/[0.06]"
                        }`}
                      >
                        <span className={`text-3xl transition-transform duration-200 ${dragging ? "scale-125" : ""}`}>📸</span>
                        <p className="text-sm font-medium text-zinc-300">Drop a photo or click</p>
                        <p className="text-xs text-zinc-600">JPG, PNG, WEBP</p>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }} />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={label}>
                      Prompt <span className="text-zinc-600 normal-case font-normal tracking-normal">(optional)</span>
                    </label>
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleGenerate(); } }}
                      placeholder="e.g. wearing a chef hat in a cozy kitchen..."
                      rows={3} className={inputDark} />
                    <p className="text-xs text-zinc-600">⌘ + Enter to generate</p>
                  </div>

                  <ModelSwitcher value={model} onChange={setModel} />

                  <div className="flex flex-col gap-2">
                    <label className={label}>Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                      {ASPECT_RATIOS.map((r) => (
                        <button key={r.value} onClick={() => setAspectRatio(r.value)}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all duration-200 ${
                            aspectRatio === r.value ? chipOn : chipOff
                          }`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className={label}>
                      Images — <span className="text-orange-400">{numOutputs}</span>
                    </label>
                    <input type="range" min={1} max={4} value={numOutputs}
                      onChange={(e) => setNumOutputs(Number(e.target.value))}
                      className="w-full" />
                    <div className="flex justify-between text-xs text-zinc-600"><span>1</span><span>4</span></div>
                  </div>

                  <button onClick={handleGenerate} disabled={loading || !photo}
                    className="btn-primary w-full py-3.5 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center gap-2">
                    {loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating...</>) : <>✨ Generate Pixar Art</>}
                  </button>

                  {!photo && <p className="text-xs text-center text-zinc-600">Upload a pet photo to get started</p>}
                  {error && <div className={errorBox}>{error}</div>}
                </aside>

                <section className="flex-1 overflow-y-auto p-6">
                  {history.length === 0 && !loading ? (
                    <div className="h-full flex flex-col items-center justify-center gap-4">
                      <div className="text-7xl animate-float">🐾</div>
                      <p className="text-base font-semibold text-zinc-300">Your Pixar pet portraits will appear here</p>
                      <p className="text-sm text-zinc-600">Upload a photo and hit Generate ✨</p>
                    </div>
                  ) : (
                    <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                      {loading && Array.from({ length: numOutputs }).map((_, i) => (
                        <div key={`sk-${i}`} className="break-inside-avoid rounded-xl skeleton" style={{ aspectRatio: aspectRatio.replace(":", "/") }} />
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
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ── EDIT TAB ────────────────────────────────────── */}
            {activeTab === "history" && (
              <section className="flex-1 overflow-y-auto p-8 animate-fade-in">
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div className="animate-slide-in-left">
                    <h2 className="text-2xl font-bold text-white tracking-tight">Edit</h2>
                    <p className="text-sm text-zinc-500 mt-0.5">
                      {history.length} image{history.length !== 1 ? "s" : ""} generated
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 text-sm">🔍</span>
                      <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search prompts..."
                        className="pl-8 pr-4 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-orange-400/60 focus:ring-2 focus:ring-orange-400/15 w-52 transition-all duration-200" />
                    </div>
                    {history.length > 0 && (
                      <button onClick={() => { if (confirm("Clear all history?")) setHistory([]); }}
                        className="text-xs text-red-400/70 hover:text-red-400 transition-colors font-medium px-3 py-2 rounded-lg hover:bg-red-500/10">
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
                          ? "bg-white text-black shadow-lg shadow-white/10"
                          : "bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.2]"
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
                              ? "bg-orange-500 text-white shadow-lg shadow-orange-500/25"
                              : "bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:text-orange-300 hover:border-orange-400/40"
                          }`}>
                          {m.name} · {count}
                        </button>
                      );
                    })}
                  </div>
                )}

                {filteredHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <div className="text-6xl animate-float">🐾</div>
                    <p className="text-base font-semibold text-zinc-300">
                      {history.length === 0 ? "No images yet" : "No results found"}
                    </p>
                    <p className="text-sm text-zinc-600">
                      {history.length === 0 ? "Generate your first Pixar pet portrait" : "Try a different search or filter"}
                    </p>
                  </div>
                ) : (
                  <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
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
          <button className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl bg-white/[0.06] hover:bg-white/[0.15] w-10 h-10 rounded-full flex items-center justify-center transition-all"
            onClick={() => setLightbox(null)}>
            ✕
          </button>
          <Image src={lightbox} alt="Preview" width={1024} height={1024}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl animate-scale-in"
            unoptimized onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
