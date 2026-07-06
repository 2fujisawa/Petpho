"use client";

import Image from "next/image";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { MODELS, DEFAULT_MODEL, type ModelId } from "@/lib/models";
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
    d.width = w;
    d.height = h;
    m.width = w;
    m.height = h;
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

    dctx.beginPath();
    dctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.beginPath();
    mctx.arc(x, y, r, 0, Math.PI * 2);

    if (tool === "brush") {
      dctx.fillStyle = "rgba(255, 80, 0, 0.5)";
      dctx.fill();
      mctx.fillStyle = "#fff";
      mctx.fill();
    } else {
      dctx.globalCompositeOperation = "destination-out";
      dctx.fillStyle = "rgba(0,0,0,1)";
      dctx.fill();
      dctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = "#000";
      mctx.fill();
    }
  }

  return (
    <div className="relative select-none rounded-xl overflow-hidden border-2 border-orange-200 shadow-sm">
      <img
        src={imageUrl}
        alt="Inpaint target"
        className="w-full h-auto block"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          initCanvases(img.naturalWidth, img.naturalHeight);
        }}
      />
      <canvas
        ref={displayRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        style={{ touchAction: "none" }}
        onMouseDown={(e) => { drawingRef.current = true; paint(e); }}
        onMouseMove={paint}
        onMouseUp={() => { drawingRef.current = false; }}
        onMouseLeave={() => { drawingRef.current = false; }}
      />
      <canvas ref={maskRef} className="hidden" />
    </div>
  );
});

function ModelSwitcher({
  value,
  onChange,
}: {
  value: ModelId;
  onChange: (id: ModelId) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
        Model
      </label>
      <div className="flex flex-col gap-1.5">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
              value === m.id
                ? "bg-orange-400 border-orange-400 text-white shadow-sm"
                : "bg-orange-50 border-orange-200 text-gray-700 hover:bg-orange-100 hover:border-orange-300"
            }`}
          >
            <p className="text-xs font-bold leading-tight">{m.name}</p>
            <p
              className={`text-xs mt-0.5 leading-tight ${
                value === m.id ? "text-white/80" : "text-gray-400"
              }`}
            >
              {m.provider} — {m.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function BackgroundPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
        Background <span className="text-gray-400 normal-case font-normal">(optional)</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChange(null)}
          className={`col-span-2 text-xs px-3 py-2 rounded-xl border font-medium transition-all ${
            value === null
              ? "bg-orange-400 border-orange-400 text-white shadow-sm"
              : "bg-orange-50 border-orange-200 text-gray-600 hover:bg-orange-100"
          }`}
        >
          ✕ No Background
        </button>
        {BACKGROUNDS.map((bg) => (
          <button
            key={bg.id}
            onClick={() => onChange(value === bg.id ? null : bg.id)}
            className={`flex flex-col rounded-xl overflow-hidden border-2 transition-all text-left ${
              value === bg.id
                ? "border-orange-400 shadow-sm"
                : "border-orange-100 hover:border-orange-300"
            }`}
          >
            <div className="h-16 overflow-hidden" style={{ background: bg.gradient }} />
            <p className="text-xs font-medium text-gray-700 py-1.5 px-2 leading-tight bg-white">
              {bg.name}
            </p>
          </button>
        ))}
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
  const [composeTarget, setComposeTarget] = useState<GeneratedImage | null>(null);
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

  // Load history from localStorage after client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("petpho-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  // Save history to localStorage, but skip the very first run (initial empty [])
  // so we don't wipe data before the load effect above has set the state
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
        url,
        prompt: editor.editPrompt,
        model: "black-forest-labs/flux-fill-pro" as ModelId,
        sourceUrl: editor.sourceImage.url,
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
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return;
          const compressed = new File([blob], file.name, { type: "image/jpeg" });
          setPhoto(compressed);
          setPhotoPreview(URL.createObjectURL(compressed));
        },
        "image/jpeg",
        0.85
      );
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
      // Build output canvas at the target aspect ratio with dog scaled to photoZoom
      const zoomedPhoto = await new Promise<File>((resolve) => {
        const img = document.createElement("img");
        img.onload = () => {
          const [arW, arH] = (aspectRatio || "1:1").split(":").map(Number);
          const TARGET = 1024;
          const arScale = Math.min(TARGET / arW, TARGET / arH);
          const canvasW = Math.round(arW * arScale);
          const canvasH = Math.round(arH * arScale);

          const canvas = document.createElement("canvas");
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvasW, canvasH);

          // object-fit:contain the dog within photoZoom % of the canvas
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
        url,
        prompt: prompt || "Pixar style",
        model,
        createdAt: now,
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
      sourceImage: img,
      editPrompt: "",
      selectedBackground: null,
      numOutputs: 1,
      aspectRatio: "1:1",
      model: img.model,
      loading: false,
      error: null,
      results: [],
      mode: "text",
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
      const res = await fetch("/api/compose", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Compose failed");
      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url,
        prompt: composeTarget.prompt + " (placed in scene)",
        model: "google/nano-banana" as ModelId,
        sourceUrl: composeTarget.url,
      }));
      setHistory((h) => [...newImages, ...h]);
      setComposeTarget(null);
      setBackgroundPhoto(null);
      setBackgroundPhotoPreview(null);
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
      ]
        .filter(Boolean)
        .join(", also ");

      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: editor.sourceImage.url,
          editPrompt: combinedPrompt,
          aspectRatio: editor.aspectRatio,
          numOutputs: editor.numOutputs,
          model: editor.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Edit failed");

      const newImages: GeneratedImage[] = (data.images as string[]).map((url) => ({
        url,
        prompt: editor.editPrompt,
        model: editor.model,
        sourceUrl: editor.sourceImage.url,
      }));

      setHistory((prev) => [...newImages, ...prev]);
      setEditor((e) => e && { ...e, results: [...newImages, ...e.results], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setEditor((e) => e && { ...e, error: msg, loading: false });
    }
  }

  // =========================================================
  // COMPOSE VIEW — place generated pet into a background scene
  // =========================================================
  if (composeTarget) {
    return (
      <main className="min-h-screen flex flex-col bg-orange-50">
        <div className="bg-sky-500 text-white text-center text-sm font-medium py-2 tracking-wide">
          🖼️ Place in Background Scene
        </div>
        <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-4 shadow-sm">
          <button
            onClick={() => { setComposeTarget(null); setBackgroundPhoto(null); setBackgroundPhotoPreview(null); setComposeError(null); }}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-sky-500 transition-colors"
          >
            ← Back
          </button>
          <span className="text-sky-500 font-semibold text-sm">Place in Scene</span>
        </header>
        <div className="flex flex-1 gap-0">
          {/* Sidebar */}
          <aside className="w-80 bg-white border-r border-orange-100 flex flex-col gap-5 p-5 overflow-y-auto">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Your Pixar Pet</label>
              <div className="rounded-xl overflow-hidden border border-orange-200">
                <img src={composeTarget.url} alt="Pixar pet" className="w-full h-40 object-cover" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                Background Photo
              </label>
              {backgroundPhotoPreview ? (
                <div className="relative rounded-xl overflow-hidden border-2 border-sky-300 shadow-sm">
                  <img src={backgroundPhotoPreview} alt="Background" className="w-full h-40 object-cover" />
                  <button
                    onClick={() => { setBackgroundPhoto(null); setBackgroundPhotoPreview(null); }}
                    className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white text-xs px-2 py-1 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => bgFileInputRef.current?.click()}
                  className="cursor-pointer flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 hover:border-sky-400 hover:bg-sky-100 py-8 transition-all"
                >
                  <span className="text-3xl">🖼️</span>
                  <p className="text-sm font-medium text-gray-600">Upload a background photo</p>
                  <p className="text-xs text-gray-400">The AI will place your pet inside it</p>
                </div>
              )}
              <input
                ref={bgFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBackgroundPhoto(file);
                  setBackgroundPhotoPreview(URL.createObjectURL(file));
                  e.target.value = "";
                }}
              />
            </div>

            {composeError && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{composeError}</p>
            )}

            <button
              onClick={handleCompose}
              disabled={composeLoading || !backgroundPhoto}
              className="w-full py-3 rounded-2xl font-semibold text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center gap-2"
            >
              {composeLoading
                ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Composing...</>)
                : <>🖼️ Place in Scene</>}
            </button>
          </aside>

          {/* Results area */}
          <section className="flex-1 p-6 overflow-y-auto">
            {composeLoading && (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <span className="w-10 h-10 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Placing your pet in the scene...</p>
              </div>
            )}
            {!composeLoading && !backgroundPhoto && (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
                <span className="text-5xl">🖼️</span>
                <p className="text-sm font-medium">Upload a background photo to get started</p>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  // =========================================================
  // EDITOR VIEW
  // =========================================================
  if (editor) {
    return (
      <main className="min-h-screen flex flex-col bg-orange-50">
        <div className="bg-orange-400 text-white text-center text-sm font-medium py-2 tracking-wide">
          🎨 Image Editor — Pixar Style
        </div>
        <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-4 shadow-sm">
          <button
            onClick={() => setEditor(null)}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-orange-500 transition-colors"
          >
            ← Back to Gallery
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-400 flex items-center justify-center text-white text-sm font-bold">
              🐶
            </div>
            <span className="font-extrabold text-lg text-gray-800">PETPHO</span>
            <span className="text-orange-400 font-semibold text-sm">Editor</span>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col w-80 bg-white border-r border-orange-100 p-5 gap-4 overflow-y-auto">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Source Image</p>
            <div className="rounded-2xl overflow-hidden border-2 border-orange-200 shadow-sm">
              <Image
                src={editor.sourceImage.url}
                alt="Source"
                width={320}
                height={320}
                className="w-full h-auto object-cover"
                unoptimized
              />
            </div>
            <p className="text-xs text-gray-400 italic line-clamp-2">
              &ldquo;{editor.sourceImage.prompt}&rdquo;
            </p>

            {/* Mode switcher */}
            <div className="flex rounded-xl border border-orange-200 overflow-hidden text-xs font-bold">
              <button
                onClick={() => setEditor((e) => e && { ...e, mode: "text" })}
                className={`flex-1 py-2 transition-colors ${editor.mode === "text" ? "bg-orange-400 text-white" : "bg-orange-50 text-gray-600 hover:bg-orange-100"}`}
              >
                ✏️ Text Edit
              </button>
              <button
                onClick={() => setEditor((e) => e && { ...e, mode: "brush" })}
                className={`flex-1 py-2 transition-colors ${editor.mode === "brush" ? "bg-orange-400 text-white" : "bg-orange-50 text-gray-600 hover:bg-orange-100"}`}
              >
                🖌️ Brush Inpaint
              </button>
            </div>

            <div className="border-t border-orange-100 pt-4 flex flex-col gap-4">
              {editor.mode === "text" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Edit Prompt</label>
                    <textarea
                      value={editor.editPrompt}
                      onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleApplyEdit(); } }}
                      placeholder="Describe what to change — e.g. add a party hat, change background to a beach..."
                      rows={4}
                      className="w-full bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all"
                    />
                    <p className="text-xs text-gray-400">⌘ + Enter to apply</p>
                  </div>
                  <ModelSwitcher value={editor.model} onChange={(id) => setEditor((ed) => ed && { ...ed, model: id })} />
                  <BackgroundPicker
                    value={editor.selectedBackground}
                    onChange={(id) => setEditor((ed) => ed && { ...ed, selectedBackground: id })}
                  />
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                      {ASPECT_RATIOS.map((r) => (
                        <button key={r.value} onClick={() => setEditor((ed) => ed && { ...ed, aspectRatio: r.value })}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${editor.aspectRatio === r.value ? "bg-orange-400 border-orange-400 text-white shadow-sm" : "bg-orange-50 border-orange-200 text-gray-600 hover:bg-orange-100"}`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                      Variants — <span className="text-orange-500">{editor.numOutputs}</span>
                    </label>
                    <input type="range" min={1} max={4} value={editor.numOutputs}
                      onChange={(e) => setEditor((ed) => ed && { ...ed, numOutputs: Number(e.target.value) })}
                      className="w-full accent-orange-400" />
                    <div className="flex justify-between text-xs text-gray-400"><span>1</span><span>4</span></div>
                  </div>
                  <button onClick={handleApplyEdit} disabled={editor.loading || (!editor.editPrompt.trim() && !editor.selectedBackground)}
                    className="w-full py-3 rounded-xl font-bold text-sm text-white bg-orange-400 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2">
                    {editor.loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Applying edit...</>) : <>✏️ Apply Edit</>}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                      Zoom — <span className="text-orange-500">{Math.round(canvasZoom * 100)}%</span>
                    </label>
                    <input type="range" min={50} max={300} step={10} value={canvasZoom * 100} onChange={(e) => setCanvasZoom(Number(e.target.value) / 100)} className="w-full accent-orange-400" />
                    <div className="flex justify-between text-xs text-gray-400"><span>50%</span><span>300%</span></div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                      Brush Size — <span className="text-orange-500">{brushSize}px</span>
                    </label>
                    <input type="range" min={5} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full accent-orange-400" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setBrushTool("brush")}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${brushTool === "brush" ? "bg-orange-400 border-orange-400 text-white" : "bg-orange-50 border-orange-200 text-gray-600 hover:bg-orange-100"}`}>
                      🖌️ Brush
                    </button>
                    <button onClick={() => setBrushTool("eraser")}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${brushTool === "eraser" ? "bg-orange-400 border-orange-400 text-white" : "bg-orange-50 border-orange-200 text-gray-600 hover:bg-orange-100"}`}>
                      ⬜ Eraser
                    </button>
                    <button onClick={() => inpaintCanvasRef.current?.clear()}
                      className="px-3 py-2 rounded-xl text-xs font-bold border border-orange-200 bg-orange-50 text-gray-600 hover:bg-orange-100 transition-all">
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">What to Change</label>
                    <textarea
                      value={editor.editPrompt}
                      onChange={(e) => setEditor((ed) => ed && { ...ed, editPrompt: e.target.value })}
                      placeholder="Describe what to put in the brushed area — e.g. a party hat, sunglasses..."
                      rows={3}
                      className="w-full bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all"
                    />
                  </div>
                  <button onClick={handleApplyInpaint} disabled={editor.loading || !editor.editPrompt.trim()}
                    className="w-full py-3 rounded-xl font-bold text-sm text-white bg-orange-400 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2">
                    {editor.loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Inpainting...</>) : <>🖌️ Apply Inpaint</>}
                  </button>
                </>
              )}
              {editor.error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {editor.error}
                </div>
              )}
            </div>
          </div>

          <section className="flex-1 overflow-y-auto p-6">
            {editor.mode === "brush" ? (
              <div className="flex flex-col gap-6">
                <div className="overflow-auto">
                  <div style={{ transform: `scale(${canvasZoom})`, transformOrigin: "top left", display: "inline-block", width: `${100 / canvasZoom}%` }}>
                    <InpaintCanvas
                      key={editor.sourceImage.url}
                      ref={inpaintCanvasRef}
                      imageUrl={editor.sourceImage.url}
                      brushSize={brushSize}
                      tool={brushTool}
                    />
                  </div>
                </div>
                {editor.loading && (
                  <div className="rounded-2xl bg-orange-100 border border-orange-200 animate-pulse" style={{ aspectRatio: "1/1" }} />
                )}
                {editor.results.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Inpaint Results</p>
                    <div className="flex flex-wrap gap-3">
                      {editor.results.map((img, i) => (
                        <div key={`${img.url}-${i}`}
                          className="group relative rounded-2xl overflow-hidden border-2 border-transparent hover:border-orange-400 transition-all shadow-sm hover:shadow-md cursor-pointer w-64"
                          onClick={() => setLightbox(img.url)}>
                          <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover" unoptimized />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                            <p className="text-xs text-white/90 line-clamp-2 font-medium">{img.prompt}</p>
                            <div className="flex gap-2">
                              <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className="text-xs bg-orange-400 hover:bg-orange-500 text-white px-2 py-1 rounded-lg transition-colors font-medium">Edit this</button>
                              <a href={img.url} download onClick={(e) => e.stopPropagation()} className="text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-lg transition-colors">Download</a>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : editor.results.length === 0 && !editor.loading ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
                <div className="text-6xl">✏️</div>
                <p className="text-base font-medium text-gray-500">Describe your edit and hit Apply</p>
                <p className="text-sm text-gray-400">Each edit builds on the source image</p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {editor.loading && (
                  <div className="flex gap-3">
                    {Array.from({ length: editor.numOutputs }).map((_, i) => (
                      <div key={`sk-${i}`} className="flex-1 rounded-2xl bg-orange-100 border border-orange-200 animate-pulse"
                        style={{ aspectRatio: editor.aspectRatio.replace(":", "/") }} />
                    ))}
                  </div>
                )}
                {editor.results.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Edit Results</p>
                    <div className="flex flex-wrap gap-3">
                      {editor.results.map((img, i) => (
                        <div key={`${img.url}-${i}`}
                          className="group relative rounded-2xl overflow-hidden border-2 border-transparent hover:border-orange-400 transition-all shadow-sm hover:shadow-md cursor-pointer w-64"
                          onClick={() => setLightbox(img.url)}>
                          <Image src={img.url} alt={img.prompt} width={512} height={512} className="w-full h-auto object-cover" unoptimized />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                            <p className="text-xs text-white/90 line-clamp-2 font-medium">{img.prompt}</p>
                            <div className="flex gap-2">
                              <button onClick={(e) => { e.stopPropagation(); openEditor(img); }} className="text-xs bg-orange-400 hover:bg-orange-500 text-white px-2 py-1 rounded-lg transition-colors font-medium">Edit this</button>
                              <a href={img.url} download onClick={(e) => e.stopPropagation()} className="text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-lg transition-colors">Download</a>
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

        {lightbox && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
            onClick={() => setLightbox(null)}
          >
            <button
              className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl bg-black/30 w-10 h-10 rounded-full flex items-center justify-center"
              onClick={() => setLightbox(null)}
            >
              ✕
            </button>
            <Image
              src={lightbox}
              alt="Preview"
              width={1024}
              height={1024}
              className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
              unoptimized
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </main>
    );
  }

  // =========================================================
  // MAIN GALLERY VIEW
  // =========================================================
  const MODEL_BADGE: Record<string, string> = {
    "black-forest-labs/flux-kontext-pro": "bg-violet-100 text-violet-700",
    "stability-ai/stable-diffusion-3.5-large": "bg-blue-100 text-blue-700",
    "ideogram-ai/ideogram-v2-turbo": "bg-emerald-100 text-emerald-700",
    "google/nano-banana": "bg-amber-100 text-amber-700",
    "qwen/qwen-image-edit-plus": "bg-indigo-100 text-indigo-700",
    "bytedance/seedream-4": "bg-pink-100 text-pink-700",
  };

  const filteredHistory = history.filter((img) => {
    const matchSearch = !historySearch || img.prompt.toLowerCase().includes(historySearch.toLowerCase());
    const matchFilter = !historyFilter || img.model === historyFilter;
    return matchSearch && matchFilter;
  });

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

  return (
    <main className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 flex items-center justify-between shadow-sm z-10">
        {/* Logo */}
        <div className="flex items-center gap-3 py-4">
          <div className="w-9 h-9 rounded-xl bg-orange-400 flex items-center justify-center text-white font-extrabold shadow-sm">
            🐶
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-extrabold text-lg tracking-tight text-gray-900">PETPHO</span>
            <span className="text-orange-400 font-semibold text-sm">Gen</span>
            <span className="text-xs text-orange-500 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-full font-medium">Admin</span>
          </div>
        </div>

        {/* Tab nav */}
        <nav className="flex h-full">
          {(["generate", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-6 py-5 text-sm font-semibold transition-colors flex items-center gap-2 ${
                activeTab === tab ? "text-orange-500" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              {tab === "generate" ? "✨ Generate" : "🗂 History"}
              {tab === "history" && history.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold transition-colors ${
                  activeTab === "history" ? "bg-orange-100 text-orange-500" : "bg-gray-100 text-gray-500"
                }`}>
                  {history.length}
                </span>
              )}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-orange-400 rounded-t-full" />
              )}
            </button>
          ))}
        </nav>

        <span className="text-sm text-gray-400 font-medium">Pixar Image Generator ✨</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── HISTORY TAB ─────────────────────────────────── */}
        {activeTab === "history" && (
          <section className="flex-1 overflow-y-auto p-8 animate-fade-in">
            {/* Top bar */}
            <div className="flex items-start justify-between mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">History</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {history.length} image{history.length !== 1 ? "s" : ""} generated
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search prompts..."
                    className="pl-8 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 w-52 transition-all"
                  />
                </div>
                {history.length > 0 && (
                  <button
                    onClick={() => { if (confirm("Clear all history?")) setHistory([]); }}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors font-medium px-3 py-2 rounded-lg hover:bg-red-50"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Model filter chips */}
            {history.length > 0 && (
              <div className="flex gap-2 mb-6 flex-wrap">
                <button
                  onClick={() => setHistoryFilter(null)}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all ${
                    historyFilter === null
                      ? "bg-gray-900 text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  All · {history.length}
                </button>
                {MODELS.map((m) => {
                  const count = history.filter((img) => img.model === m.id).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setHistoryFilter(historyFilter === m.id ? null : m.id)}
                      className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-all ${
                        historyFilter === m.id
                          ? "bg-orange-400 text-white shadow-sm"
                          : "bg-white border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600"
                      }`}
                    >
                      {m.name} · {count}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Grid */}
            {filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4 text-gray-400">
                <div className="text-6xl">🐾</div>
                <p className="text-base font-semibold text-gray-600">
                  {history.length === 0 ? "No images yet" : "No results found"}
                </p>
                <p className="text-sm text-gray-400">
                  {history.length === 0 ? "Generate your first Pixar pet portrait" : "Try a different search or filter"}
                </p>
              </div>
            ) : (
              <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
                {filteredHistory.map((img, i) => {
                  const isBroken = brokenImages.has(img.url);
                  const modelName = MODELS.find((m) => m.id === img.model)?.name ?? img.model.split("/")[1];
                  const badgeClass = MODEL_BADGE[img.model] ?? "bg-gray-100 text-gray-600";
                  return (
                    <div
                      key={`hist-${img.url}-${i}`}
                      className="break-inside-avoid animate-fade-up"
                      style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                    >
                      <div
                        className={`group relative rounded-2xl overflow-hidden bg-white shadow-sm transition-all duration-200 ${
                          isBroken ? "cursor-default" : "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                        }`}
                        onClick={() => !isBroken && setLightbox(img.url)}
                      >
                        {isBroken ? (
                          <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4 bg-gray-50">
                            <span className="text-3xl opacity-30">🖼️</span>
                            <p className="text-xs text-gray-400 font-medium">Expired</p>
                            <button
                              onClick={(e) => { e.stopPropagation(); setHistory((h) => h.filter((x) => x.url !== img.url)); }}
                              className="text-xs bg-red-100 hover:bg-red-200 text-red-500 px-3 py-1 rounded-lg transition-colors font-medium mt-1"
                            >Remove</button>
                          </div>
                        ) : (
                          <>
                            <Image
                              src={img.url}
                              alt={img.prompt}
                              width={512} height={512}
                              className="w-full h-auto object-cover"
                              unoptimized
                              onError={() => setBrokenImages((prev) => new Set(prev).add(img.url))}
                            />
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 gap-2">
                              <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed">{img.prompt}</p>
                              <div className="flex gap-1.5 flex-wrap">
                                <button onClick={(e) => { e.stopPropagation(); openEditor(img); }}
                                  className="text-xs bg-orange-400 hover:bg-orange-500 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">
                                  ✏️ Edit
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setComposeTarget(img); }}
                                  className="text-xs bg-sky-500 hover:bg-sky-600 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">
                                  🖼️ Scene
                                </button>
                                <a href={img.url} download onClick={(e) => e.stopPropagation()}
                                  className="text-xs bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition-colors">
                                  ↓
                                </a>
                                <button onClick={(e) => { e.stopPropagation(); setHistory((h) => h.filter((x) => x.url !== img.url)); }}
                                  className="text-xs bg-red-500/70 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg transition-colors">
                                  🗑️
                                </button>
                              </div>
                            </div>
                            {/* Bottom meta bar */}
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
                            {/* Badges always visible */}
                            <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
                              {img.sourceUrl && (
                                <span className="text-xs bg-orange-400 text-white px-1.5 py-0.5 rounded-md font-semibold">Edited</span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ml-auto ${badgeClass}`}>
                                {modelName}
                              </span>
                            </div>
                            {formatDate(img.createdAt) && (
                              <div className="absolute bottom-2 right-2 pointer-events-none">
                                <span className="text-xs bg-black/40 text-white/80 px-1.5 py-0.5 rounded-md font-medium">
                                  {formatDate(img.createdAt)}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── GENERATE TAB ────────────────────────────────── */}
        {activeTab === "generate" && (
          <>
        <aside className="w-80 bg-white border-r border-gray-100 flex flex-col gap-5 p-6 overflow-y-auto shadow-sm">
          {/* Photo upload */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              Pet Photo
            </label>
            {photoPreview ? (
              <div className="flex flex-col gap-2">
                <div className="relative rounded-2xl overflow-hidden border-2 border-orange-300 shadow-sm bg-white flex items-center justify-center w-full" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
                  <img
                    src={photoPreview}
                    alt="Uploaded pet"
                    style={{ width: `${photoZoom * 100}%`, height: `${photoZoom * 100}%`, objectFit: "contain" }}
                  />
                  <button
                    onClick={() => { setPhoto(null); setPhotoPreview(null); setPhotoZoom(1); }}
                    className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white text-xs px-2 py-1 rounded-lg transition-colors"
                  >
                    Change
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                    Dog Scale — <span className="text-orange-500">{Math.round(photoZoom * 100)}%</span>
                  </label>
                  <input type="range" min={20} max={100} value={photoZoom * 100}
                    onChange={(e) => setPhotoZoom(Number(e.target.value) / 100)}
                    className="w-full accent-orange-400" />
                  <div className="flex justify-between text-xs text-gray-400"><span>Zoomed out</span><span>Full size</span></div>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-8 transition-all ${
                  dragging
                    ? "border-orange-400 bg-orange-100"
                    : "border-orange-200 bg-orange-50 hover:border-orange-400 hover:bg-orange-100"
                }`}
              >
                <span className="text-3xl">📸</span>
                <p className="text-sm font-medium text-gray-600">Drop a photo or click to upload</p>
                <p className="text-xs text-gray-400">JPG, PNG, WEBP</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              Prompt <span className="text-gray-400 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="e.g. wearing a chef hat in a cozy kitchen..."
              rows={3}
              className="w-full bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all"
            />
            <p className="text-xs text-gray-400">⌘ + Enter to generate</p>
          </div>

          {/* Model switcher */}
          <ModelSwitcher value={model} onChange={setModel} />


          {/* Aspect ratio */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              Aspect Ratio
            </label>
            <div className="flex flex-wrap gap-2">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setAspectRatio(r.value)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                    aspectRatio === r.value
                      ? "bg-orange-400 border-orange-400 text-white shadow-sm"
                      : "bg-orange-50 border-orange-200 text-gray-600 hover:bg-orange-100 hover:border-orange-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Number of images */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              Images — <span className="text-orange-500">{numOutputs}</span>
            </label>
            <input
              type="range"
              min={1}
              max={4}
              value={numOutputs}
              onChange={(e) => setNumOutputs(Number(e.target.value))}
              className="w-full accent-orange-400"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>1</span><span>4</span>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !photo}
            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-orange-400 hover:bg-orange-500 active:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>✨ Generate Pixar Art</>
            )}
          </button>

          {!photo && (
            <p className="text-xs text-center text-gray-400">Upload a pet photo to get started</p>
          )}
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </aside>

        {/* Generate gallery */}
        <section className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {history.length === 0 && !loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
              <div className="text-7xl">🐾</div>
              <p className="text-base font-semibold text-gray-600">Your Pixar pet portraits will appear here</p>
              <p className="text-sm text-gray-400">Upload a photo and hit Generate ✨</p>
            </div>
          ) : (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
              {loading && Array.from({ length: numOutputs }).map((_, i) => (
                <div key={`sk-${i}`}
                  className="break-inside-avoid rounded-2xl bg-white border border-gray-100 animate-pulse shadow-sm"
                  style={{ aspectRatio: aspectRatio.replace(":", "/") }}
                />
              ))}
              {history.map((img, i) => {
                const isBroken = brokenImages.has(img.url);
                const modelName = MODELS.find((m) => m.id === img.model)?.name ?? img.model.split("/")[1];
                const badgeClass = MODEL_BADGE[img.model] ?? "bg-gray-100 text-gray-600";
                return (
                  <div key={`gen-${img.url}-${i}`}
                    className="break-inside-avoid animate-fade-up"
                    style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
                  >
                    <div
                      className={`group relative rounded-2xl overflow-hidden bg-white shadow-sm transition-all duration-200 ${
                        isBroken ? "cursor-default" : "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                      }`}
                      onClick={() => !isBroken && setLightbox(img.url)}
                    >
                      {isBroken ? (
                        <div className="aspect-square flex flex-col items-center justify-center gap-2 p-4 bg-gray-50">
                          <span className="text-3xl opacity-30">🖼️</span>
                          <p className="text-xs text-gray-400 font-medium">Expired</p>
                          <button onClick={(e) => { e.stopPropagation(); setHistory((h) => h.filter((x) => x.url !== img.url)); }}
                            className="text-xs bg-red-100 hover:bg-red-200 text-red-500 px-3 py-1 rounded-lg transition-colors font-medium mt-1">
                            Remove
                          </button>
                        </div>
                      ) : (
                        <>
                          <Image src={img.url} alt={img.prompt} width={512} height={512}
                            className="w-full h-auto object-cover" unoptimized
                            onError={() => setBrokenImages((prev) => new Set(prev).add(img.url))}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 gap-2">
                            <p className="text-xs text-white/90 line-clamp-2 font-medium leading-relaxed">{img.prompt}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              <button onClick={(e) => { e.stopPropagation(); openEditor(img); }}
                                className="text-xs bg-orange-400 hover:bg-orange-500 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">✏️ Edit</button>
                              <button onClick={(e) => { e.stopPropagation(); setComposeTarget(img); }}
                                className="text-xs bg-sky-500 hover:bg-sky-600 text-white px-2.5 py-1 rounded-lg transition-colors font-semibold">🖼️ Scene</button>
                              <a href={img.url} download onClick={(e) => e.stopPropagation()}
                                className="text-xs bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition-colors">↓</a>
                              <button onClick={(e) => { e.stopPropagation(); setHistory((h) => h.filter((x) => x.url !== img.url)); }}
                                className="text-xs bg-red-500/70 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg transition-colors">🗑️</button>
                            </div>
                          </div>
                          <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none">
                            {img.sourceUrl && <span className="text-xs bg-orange-400 text-white px-1.5 py-0.5 rounded-md font-semibold">Edited</span>}
                            <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ml-auto ${badgeClass}`}>{modelName}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
          </>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl bg-black/30 w-10 h-10 rounded-full flex items-center justify-center"
            onClick={() => setLightbox(null)}
          >
            ✕
          </button>
          <Image
            src={lightbox}
            alt="Preview"
            width={1024}
            height={1024}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            unoptimized
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}
