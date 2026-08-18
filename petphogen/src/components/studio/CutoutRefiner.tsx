"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type CutoutRefinerHandle = {
  toBlob: () => Promise<Blob | null>;
  reset: () => void;
};

// Manual touch-up for an automatic cutout: erase leftover background the model
// missed, or paint back parts of the pet it trimmed off. The untouched original
// is kept on an offscreen canvas to sample from when restoring.
export const CutoutRefiner = forwardRef<
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
