"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { clamp, stepBrush } from "@/lib/geometry";

// Wheel over a canvas resizes the brush; Ctrl/⌘ + wheel zooms. Registered
// natively because React's wheel listener is passive, so preventDefault there
// wouldn't stop the page scrolling / browser zooming.
//
// `active` must track whether the target element is currently mounted — the
// listener is (re)attached whenever it flips true, so it always lands on the
// live element rather than one React has since replaced.
export function useWheelBrushZoom(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  {
    setZoom,
    zoomBounds: [zoomMin, zoomMax],
    setBrush,
  }: {
    setZoom: Dispatch<SetStateAction<number>>;
    zoomBounds: [number, number];
    setBrush: Dispatch<SetStateAction<number>>;
  }
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.12 : 0.89), zoomMin, zoomMax));
      } else {
        setBrush((s) => stepBrush(s, e.deltaY));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, active, setZoom, setBrush, zoomMin, zoomMax]);
}
