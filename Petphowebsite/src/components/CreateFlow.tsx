"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { removeBackground } from "@imgly/background-removal";

type ArtResult = {
  style: string;
  description: string;
  imageUrl: string;
  noBgUrl?: string;
};

type Step = "upload" | "generating" | "pick" | "product" | "arrange";

type ProductType = {
  id: string;
  name: string;
  description: string;
  price: string;
  emoji: string;
  specs: string[];
};

const PRODUCTS: ProductType[] = [
  {
    id: "mug",
    name: "11oz Mug",
    description: "For your daily coffee time",
    price: "$29",
    emoji: "☕",
    specs: ["Size: 11oz (325ml)", "Material: Ceramic", "Microwave and dishwasher safe"],
  },
  {
    id: "tshirt",
    name: "T-shirt",
    description: "Available in 4 colors and 4 sizes",
    price: "$35",
    emoji: "👕",
    specs: ["Sizes: S, M, L, XL", "Material: 100% Cotton", "Machine washable"],
  },
  {
    id: "canvas",
    name: "Canvas Print",
    description: "Gallery-quality wall art",
    price: "$45",
    emoji: "🖼️",
    specs: ["Size: 30×30 cm", "Material: Premium cotton canvas", "Ready to hang"],
  },
  {
    id: "bag",
    name: "Shopping Bag",
    description: "All-over print, foldable eco-bag",
    price: "$39",
    emoji: "🛍️",
    specs: ["Size: 38×40 cm", "Material: Non-woven fabric", "Foldable and reusable"],
  },
];

const TSHIRT_COLORS = [
  { id: "white", label: "White", fill: "#f9fafb", stroke: "#e5e7eb" },
  { id: "black", label: "Black", fill: "#1f2937", stroke: "#374151" },
  { id: "navy", label: "Navy", fill: "#1e3a5f", stroke: "#3b82f6" },
  { id: "gray", label: "Heather Gray", fill: "#9ca3af", stroke: "#6b7280" },
];

const TSHIRT_SIZES = ["S", "M", "L", "XL"];

/* ── Shared resize icon ── */
function ResizeIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path d="M1 7L7 1M4 7L7 4M7 4V7H4" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── T-shirt mockup with drag + resize ── */
function TshirtMockup({ artUrl, color }: { artUrl: string; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const pointerOffsetRef = useRef({ x: 0, y: 0 });
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, size: 0 });

  const [artPos, setArtPos] = useState({ x: 84, y: 108 });
  const [artSize, setArtSize] = useState(72);

  const MIN = 36;
  const MAX = 130;

  const shirtColor = TSHIRT_COLORS.find((c) => c.id === color) ?? TSHIRT_COLORS[0];

  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    pointerOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    setArtPos({
      x: Math.max(10, Math.min(230 - artSize, e.clientX - cr.left - pointerOffsetRef.current.x)),
      y: Math.max(10, Math.min(258 - artSize, e.clientY - cr.top - pointerOffsetRef.current.y)),
    });
  };

  const onDragUp = () => { isDraggingRef.current = false; };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, y: e.clientY, size: artSize };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return;
    const delta = (e.clientX - resizeStartRef.current.x + (e.clientY - resizeStartRef.current.y)) / 2;
    setArtSize(Math.max(MIN, Math.min(MAX, Math.round(resizeStartRef.current.size + delta))));
  };

  const onResizeUp = () => { isResizingRef.current = false; };

  return (
    <div className="w-full">
      <div ref={containerRef} className="relative mx-auto select-none" style={{ width: 240, height: 268 }}>
        <svg
          viewBox="0 0 240 268"
          className="absolute inset-0 w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 80,12 C 90,48 150,48 160,12 L 218,44 L 237,74 L 220,100 L 188,82 L 188,256 L 52,256 L 52,82 L 20,100 L 3,74 L 22,44 Z"
            fill={shirtColor.fill}
            stroke={shirtColor.stroke}
            strokeWidth="1.5"
          />
        </svg>

        {/* Dashed printable area guide */}
        <div
          className="pointer-events-none absolute border border-dashed border-gray-300"
          style={{ left: 68, top: 94, width: 104, height: 120 }}
        />

        {/* Draggable art */}
        <div
          className="absolute cursor-grab active:cursor-grabbing"
          style={{ left: artPos.x, top: artPos.y, width: artSize, height: artSize, touchAction: "none", zIndex: 10 }}
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragUp}
        >
          <div className="relative w-full h-full border border-gray-400 bg-white/10">
            <Image src={artUrl} alt="Art on shirt" fill className="pointer-events-none object-contain" unoptimized />
          </div>
          {/* Resize corner */}
          <div
            className="absolute -bottom-2 -right-2 flex h-5 w-5 cursor-se-resize items-center justify-center rounded-sm border border-gray-400 bg-white shadow-sm"
            style={{ touchAction: "none" }}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          >
            <ResizeIcon />
          </div>
        </div>
      </div>

      {/* Size slider */}
      <div className="mt-5 flex items-center gap-3 px-4">
        <span className="w-8 text-xs text-gray-400">Size</span>
        <input
          type="range"
          min={MIN}
          max={MAX}
          value={artSize}
          onChange={(e) => setArtSize(Number(e.target.value))}
          className="flex-1 accent-orange-400"
        />
      </div>
      <p className="mt-2 text-center text-xs text-gray-400">
        Drag to reposition · drag corner or use slider to resize
      </p>
    </div>
  );
}

/* ── Mug mockup with drag + resize ── */
function MugMockup({ artUrl }: { artUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const pointerOffsetRef = useRef({ x: 0, y: 0 });
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, size: 0 });

  const [artPos, setArtPos] = useState({ x: 45, y: 55 });
  const [artSize, setArtSize] = useState(70);

  const MIN = 28;
  const MAX = 150;
  const W = 210;
  const H = 180;

  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    pointerOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    setArtPos({
      x: Math.max(0, Math.min(W - artSize, e.clientX - cr.left - pointerOffsetRef.current.x)),
      y: Math.max(0, Math.min(H - artSize, e.clientY - cr.top - pointerOffsetRef.current.y)),
    });
  };

  const onDragUp = () => { isDraggingRef.current = false; };

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, y: e.clientY, size: artSize };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return;
    const delta = (e.clientX - resizeStartRef.current.x + (e.clientY - resizeStartRef.current.y)) / 2;
    setArtSize(Math.max(MIN, Math.min(MAX, Math.round(resizeStartRef.current.size + delta))));
  };

  const onResizeUp = () => { isResizingRef.current = false; };

  return (
    <div className="w-full">
      <div ref={containerRef} className="relative mx-auto select-none" style={{ width: W, height: H }}>
        {/* Mug body */}
        <div
          className="absolute left-0 top-0 rounded-2xl border-2 border-gray-200 bg-white shadow-lg"
          style={{ width: 160, height: H }}
        />
        {/* Handle */}
        <div
          className="absolute border-b-2 border-r-2 border-t-2 border-gray-200 bg-transparent"
          style={{ width: 52, height: 90, right: 0, top: 45, borderRadius: "0 50% 50% 0" }}
        />

        {/* Draggable art — layered on top, not clipped by mug body */}
        <div
          className="absolute cursor-grab active:cursor-grabbing"
          style={{ left: artPos.x, top: artPos.y, width: artSize, height: artSize, touchAction: "none", zIndex: 10 }}
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragUp}
        >
          <div className="relative w-full h-full border border-gray-400 bg-white/10">
            <Image src={artUrl} alt="Art on mug" fill className="pointer-events-none object-contain" unoptimized />
          </div>
          {/* Resize corner */}
          <div
            className="absolute -bottom-2 -right-2 flex h-5 w-5 cursor-se-resize items-center justify-center rounded-sm border border-gray-400 bg-white shadow-sm"
            style={{ touchAction: "none" }}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          >
            <ResizeIcon />
          </div>
        </div>
      </div>

      {/* Size slider */}
      <div className="mt-5 flex items-center gap-3 px-4">
        <span className="w-8 text-xs text-gray-400">Size</span>
        <input
          type="range"
          min={MIN}
          max={MAX}
          value={artSize}
          onChange={(e) => setArtSize(Number(e.target.value))}
          className="flex-1 accent-orange-400"
        />
      </div>
      <p className="mt-2 text-center text-xs text-gray-400">
        Drag to reposition anywhere on the mug · resize with corner or slider
      </p>
    </div>
  );
}

/* ── Canvas mockup (static) ── */
function CanvasMockup({ artUrl }: { artUrl: string }) {
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-sm shadow-2xl"
      style={{ width: 220, height: 220, border: "12px solid #292524" }}
    >
      <Image src={artUrl} alt="Canvas" fill className="object-contain bg-white p-2" unoptimized />
    </div>
  );
}

/* ── Bag mockup (static) ── */
function BagMockup({ artUrl }: { artUrl: string }) {
  return (
    <div className="mx-auto flex items-center justify-center" style={{ width: 220, height: 220 }}>
      <div
        className="relative overflow-hidden rounded-xl border-2 border-amber-200 bg-amber-50 shadow-lg"
        style={{ width: 180, height: 200 }}
      >
        <div className="absolute top-0 border-2 border-b-0 border-amber-300 rounded-t-full" style={{ width: 40, height: 36, left: 36 }} />
        <div className="absolute top-0 border-2 border-b-0 border-amber-300 rounded-t-full" style={{ width: 40, height: 36, right: 36 }} />
        <div className="absolute flex items-center justify-center" style={{ inset: "48px 16px 16px 16px" }}>
          <div className="relative" style={{ width: 120, height: 120 }}>
            <Image src={artUrl} alt="Art on bag" fill className="object-contain" unoptimized />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared UI ── */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-[rgba(28,25,23,0.05)] bg-white p-6 shadow-sm sm:p-10">
      {children}
    </section>
  );
}

function CardHeader({ script, step, title }: { script: string; step: string; title: string }) {
  return (
    <div className="mb-8 space-y-2">
      <p className="text-xl" style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}>
        {script}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
          Step {step}
        </span>
        <h2 className="text-xl font-medium leading-snug sm:text-2xl" style={{ fontFamily: "var(--font-serif)" }}>
          {title}
        </h2>
      </div>
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-6 flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-gray-700"
    >
      ← {label}
    </button>
  );
}

function Checkmark() {
  return (
    <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-orange-500 flex items-center justify-center">
      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ── Main component ── */
export default function CreateFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<ArtResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [withoutBg, setWithoutBg] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string>("mug");
  const [tshirtColor, setTshirtColor] = useState("white");
  const [tshirtSize, setTshirtSize] = useState("M");
  const [loadPhase, setLoadPhase] = useState<"generating" | "removing">("generating");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = results[selectedIdx] ?? null;
  const displayUrl = withoutBg ? (selected?.noBgUrl ?? selected?.imageUrl) : selected?.imageUrl;
  const artUrlForProduct = selected?.noBgUrl ?? selected?.imageUrl ?? "";
  const product = PRODUCTS.find((p) => p.id === selectedProduct) ?? PRODUCTS[0];

  const handleFile = useCallback((f: File) => {
    if (!f.type.match(/^image\/(jpeg|png|webp)$/)) {
      setError("Please upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleGenerate = async () => {
    if (!file) return;
    setStep("generating");
    setLoadPhase("generating");
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch("/api/generate", { method: "POST", body: form });
      if (!res.ok) throw new Error("Generation failed. Please try again.");
      const data = await res.json();
      const raw: ArtResult[] = data.results;

      setLoadPhase("removing");

      const finalResults = await Promise.all(
        raw.map(async (r) => {
          try {
            const blob = await removeBackground(r.imageUrl);
            return { ...r, noBgUrl: URL.createObjectURL(blob) };
          } catch {
            return r;
          }
        })
      );

      setResults(finalResults);
      setSelectedIdx(0);
      setWithoutBg(false);
      setStep("pick");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStep("upload");
    }
  };

  const handleReset = () => {
    setStep("upload");
    setPreview(null);
    setFile(null);
    setResults([]);
    setSelectedIdx(0);
    setWithoutBg(false);
    setSelectedProduct("mug");
    setTshirtColor("white");
    setTshirtSize("M");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes fillbar  { from { width: 0% } to { width: 65% } }
        @keyframes fillbar2 { from { width: 65% } to { width: 95% } }
      `}</style>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ── STEP 01: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader script="upload" step="01" title="Select your pet's photo" />
          <div className="space-y-4">
            {!preview ? (
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
                  dragOver
                    ? "border-orange-400 bg-orange-50"
                    : "border-[rgba(28,25,23,0.15)] hover:border-[rgba(28,25,23,0.3)]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <div className="space-y-2">
                  <div className="text-3xl">📷</div>
                  <div className="text-sm font-medium">Click to select a photo</div>
                  <div className="text-xs text-[var(--color-muted-foreground)]">JPEG · PNG · WebP</div>
                </div>
              </label>
            ) : (
              <div className="space-y-4">
                <div className="relative aspect-square w-full max-h-64 overflow-hidden rounded-2xl bg-[var(--color-background)]">
                  <Image src={preview} alt="Your pet" fill className="object-contain" unoptimized />
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-[rgba(28,25,23,0.06)] bg-[var(--color-background)] px-4 py-3">
                  <div>
                    <p className="text-sm font-medium truncate max-w-[200px]">{file?.name}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {file ? (file.size / 1024).toFixed(0) : 0} KB
                    </p>
                  </div>
                  <button onClick={handleReset} className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
                    Change
                  </button>
                </div>
                <button
                  onClick={handleGenerate}
                  className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                >
                  Generate 3 art styles →
                </button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── STEP 02a: Generating ── */}
      {step === "generating" && (
        <Card>
          <CardHeader
            script="generating"
            step="02"
            title={loadPhase === "generating" ? "Creating your artworks…" : "Removing backgrounds…"}
          />
          <div className="space-y-5">
            {["Watercolor", "Disney / Pixar", "Anime"].map((style, i) => (
              <div key={style} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-muted-foreground)]">{style}</span>
                  <span className="text-xs text-orange-400 animate-pulse">
                    {loadPhase === "generating" ? "generating…" : "removing background…"}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-orange-100">
                  <div
                    key={`${style}-${loadPhase}`}
                    className="h-full rounded-full bg-orange-400"
                    style={{
                      animation: loadPhase === "generating"
                        ? `fillbar ${12 + i * 1.5}s ease-out forwards`
                        : `fillbar2 ${8 + i}s ease-out forwards`,
                    }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-[var(--color-muted-foreground)]">
              {loadPhase === "generating" ? "Generating all 3 styles in parallel…" : "Almost done, cutting out your pet…"}
            </p>
          </div>
        </Card>
      )}

      {/* ── STEP 02b: Pick style + background ── */}
      {step === "pick" && selected && (
        <>
          <Card>
            <BackButton label="Upload a different photo" onClick={handleReset} />
            <CardHeader script="pick a style" step="02" title="Choose your favorite" />

            <div className="grid grid-cols-3 gap-3 mb-6">
              {results.map((r, i) => (
                <button
                  key={r.style}
                  onClick={() => { setSelectedIdx(i); setWithoutBg(false); }}
                  className={`group rounded-2xl border-2 overflow-hidden text-left transition ${
                    i === selectedIdx ? "border-orange-400 shadow-sm" : "border-[rgba(28,25,23,0.06)] hover:border-orange-200"
                  }`}
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-gray-50">
                    <Image src={r.imageUrl} alt={r.style} fill className="object-cover transition duration-200 group-hover:scale-[1.03]" unoptimized />
                    {i === selectedIdx && <Checkmark />}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="text-xs font-medium truncate" style={{ fontFamily: "var(--font-serif)" }}>{r.style}</p>
                  </div>
                </button>
              ))}
            </div>

            <div className="border-t border-[rgba(28,25,23,0.06)] mb-6" />

            <div className="mb-4 space-y-1">
              <p className="text-xl" style={{ fontFamily: "var(--font-script)", color: "oklch(0.6 0.12 20)" }}>
                with or without
              </p>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">Step 02.5</span>
                <h3 className="text-lg font-medium" style={{ fontFamily: "var(--font-serif)" }}>Keep the background?</h3>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => setWithoutBg(false)}
                className={`group rounded-2xl border-2 overflow-hidden text-left transition ${
                  !withoutBg ? "border-orange-400 shadow-sm" : "border-[rgba(28,25,23,0.06)] hover:border-orange-200"
                }`}
              >
                <div className="relative aspect-square w-full overflow-hidden bg-gray-50">
                  <Image src={selected.imageUrl} alt="With background" fill className="object-cover transition duration-200 group-hover:scale-[1.02]" unoptimized />
                  {!withoutBg && <Checkmark />}
                </div>
                <div className="p-3 text-center">
                  <p className="text-sm font-medium" style={{ fontFamily: "var(--font-serif)" }}>With background</p>
                </div>
              </button>

              <button
                onClick={() => setWithoutBg(true)}
                className={`group rounded-2xl border-2 overflow-hidden text-left transition ${
                  withoutBg ? "border-orange-400 shadow-sm" : "border-[rgba(28,25,23,0.06)] hover:border-orange-200"
                }`}
              >
                <div
                  className="relative aspect-square w-full overflow-hidden"
                  style={{ backgroundImage: "repeating-conic-gradient(#e5e5e5 0% 25%, #f5f5f5 0% 50%)", backgroundSize: "20px 20px" }}
                >
                  {!selected.noBgUrl ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/60">
                      <div className="h-5 w-5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
                      <p className="text-xs text-[var(--color-muted-foreground)]">Processing…</p>
                    </div>
                  ) : (
                    <Image src={selected.noBgUrl} alt="Without background" fill className="object-contain transition duration-200 group-hover:scale-[1.02]" unoptimized />
                  )}
                  {withoutBg && selected.noBgUrl && <Checkmark />}
                </div>
                <div className="p-3 text-center">
                  <p className="text-sm font-medium" style={{ fontFamily: "var(--font-serif)" }}>Without background</p>
                </div>
              </button>
            </div>

            <button
              onClick={() => setStep("product")}
              className="mt-6 w-full rounded-2xl bg-orange-500 py-4 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Continue with this style →
            </button>
          </Card>
        </>
      )}

      {/* ── STEP 03: Choose product ── */}
      {step === "product" && (
        <Card>
          <BackButton label="Back to style" onClick={() => setStep("pick")} />
          <CardHeader script="choose product" step="03" title="Which product would you like?" />

          <div className="grid grid-cols-2 gap-3">
            {PRODUCTS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProduct(p.id)}
                className={`rounded-2xl border-2 p-5 text-left transition ${
                  selectedProduct === p.id
                    ? "border-orange-400 shadow-sm bg-orange-50/30"
                    : "border-[rgba(28,25,23,0.08)] hover:border-orange-200"
                }`}
              >
                <div className="text-2xl mb-3">{p.emoji}</div>
                <p className="font-medium text-sm" style={{ fontFamily: "var(--font-serif)" }}>{p.name}</p>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 mb-3">{p.description}</p>
                <p className="text-base font-medium" style={{ fontFamily: "var(--font-serif)" }}>{p.price}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep("arrange")}
            className="mt-6 w-full rounded-2xl bg-orange-500 py-4 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
          >
            Continue →
          </button>
        </Card>
      )}

      {/* ── STEP 03.5: Color & Size (t-shirt only) ── */}
      {step === "arrange" && selectedProduct === "tshirt" && selected && (
        <Card>
          <BackButton label="Back to products" onClick={() => setStep("product")} />
          <CardHeader script="color & size" step="03.5" title="Choose color and size" />

          <div className="space-y-6">
            <div>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">color</p>
              <div className="flex flex-wrap gap-2">
                {TSHIRT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setTshirtColor(c.id)}
                    className={`flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs transition ${
                      tshirtColor === c.id ? "border-orange-400" : "border-[rgba(28,25,23,0.1)] hover:border-orange-200"
                    }`}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-gray-200"
                      style={{ background: c.fill }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">size</p>
              <div className="flex gap-2">
                {TSHIRT_SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setTshirtSize(s)}
                    className={`h-9 w-12 rounded-full border-2 text-sm transition ${
                      tshirtSize === s ? "border-orange-400 text-orange-600" : "border-[rgba(28,25,23,0.1)] hover:border-orange-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── STEP 04: Arrange ── */}
      {step === "arrange" && selected && displayUrl && (
        <Card>
          {selectedProduct !== "tshirt" && (
            <BackButton label="Back to products" onClick={() => setStep("product")} />
          )}
          <CardHeader script="arrange" step="04" title="Arrange freely" />

          <div className="flex flex-col items-center gap-8">
            {selectedProduct === "tshirt" && (
              <TshirtMockup artUrl={artUrlForProduct} color={tshirtColor} />
            )}
            {selectedProduct === "mug" && (
              <MugMockup artUrl={artUrlForProduct} />
            )}
            {selectedProduct === "canvas" && (
              <CanvasMockup artUrl={artUrlForProduct} />
            )}
            {selectedProduct === "bag" && (
              <BagMockup artUrl={artUrlForProduct} />
            )}

            <div className="w-full rounded-2xl border border-[rgba(28,25,23,0.06)] bg-[var(--color-background)] p-4">
              <p className="text-xs font-medium mb-2">Product Specifications</p>
              <ul className="space-y-1">
                {product.specs.map((s) => (
                  <li key={s} className="text-xs text-[var(--color-muted-foreground)]">{s}</li>
                ))}
                {selectedProduct === "tshirt" && (
                  <li className="text-xs text-[var(--color-muted-foreground)]">
                    Selected: {TSHIRT_COLORS.find(c => c.id === tshirtColor)?.label} · Size {tshirtSize}
                  </li>
                )}
              </ul>
            </div>

            <div className="w-full space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{product.name}</span>
                <span className="font-medium">{product.price}</span>
              </div>
              <button
                className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                onClick={() => alert("Payment coming soon!")}
              >
                Place order — {product.price}
              </button>
              <p className="text-center text-xs text-[var(--color-muted-foreground)]">
                Secure checkout · Ships in 5–7 business days
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
