import type { CSSProperties } from "react";

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// "16:9" → 1.777…; anything unparseable reads as square rather than NaN so a
// bad value can't poison downstream layout math.
export function parseAspectRatio(value: string): number {
  const [w, h] = value.split(":").map(Number);
  return w && h ? w / h : 1;
}

// Size, in % of the frame, that content of `contentAspect` occupies when it is
// centred inside a frame of `frameAspect` without cropping — letterboxed (bars
// top/bottom) or pillarboxed (bars left/right) depending on which is
// relatively wider. Used where the rect has to be scaled/repositioned rather
// than just handed to CSS.
export function letterboxSizePct(contentAspect: number | null, frameAspect: number) {
  if (!contentAspect) return { w: 100, h: 100 };
  return contentAspect > frameAspect
    ? { w: 100, h: (frameAspect / contentAspect) * 100 }
    : { w: (contentAspect / frameAspect) * 100, h: 100 };
}

// The same fit expressed as absolute-position CSS percentages for the content
// box inside a `position: relative` frame.
export function letterboxRect(contentAspect: number | null, frameAspect: number): CSSProperties {
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

// Brush-size step for a wheel notch. Multiplicative so a notch feels the same
// at 10px as at 100px, but always moves at least 1px so small sizes don't get
// stuck rounding back to themselves.
export function stepBrush(size: number, deltaY: number) {
  const next = deltaY < 0 ? Math.max(size + 1, size * 1.1) : Math.min(size - 1, size * 0.9);
  return clamp(Math.round(next), 5, 120);
}
