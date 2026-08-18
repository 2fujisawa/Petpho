"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export type InpaintCanvasHandle = {
  getMaskDataUrl: () => string | null;
  clear: () => void;
};

// Brush-mask painter for the inpaint editor. Two stacked canvases: a visible
// tinted overlay for the user, and a hidden black/white mask at the image's
// native resolution that is what actually gets sent to the model.
export const InpaintCanvas = forwardRef<
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
