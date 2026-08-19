"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// localStorage is a hard ~5MB per origin and throws once it's full. History
// only grows, so an unguarded write eventually throws inside an effect and
// takes the page down. Drop the oldest entries and retry instead.
function persistJson<T>(key: string, value: T, trim?: (value: T, keep: number) => T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    for (const keep of [400, 150, 50]) {
      try {
        localStorage.setItem(key, JSON.stringify(trim ? trim(value, keep) : value));
        return;
      } catch {}
    }
    console.warn(`Could not persist ${key} — storage is full.`);
  }
}

// useState that survives reloads.
//
// The stored value is read in an effect, not a useState initializer:
// localStorage isn't available during SSR, so an eager read would make the
// client's first render disagree with the server-rendered HTML. The very
// first save is skipped so the initial value can't overwrite what was stored
// before it has been read back.
export function usePersistedState<T>(
  key: string,
  initial: T,
  trim?: (value: T, keep: number) => T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const skippedInitialSave = useRef(false);
  // Held in a ref so an inline `trim` arrow doesn't re-run the save effect
  // (and rewrite storage) on every render.
  const trimRef = useRef(trim);
  useEffect(() => { trimRef.current = trim; });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setValue(JSON.parse(saved));
    } catch {}
  }, [key]);

  useEffect(() => {
    if (!skippedInitialSave.current) {
      skippedInitialSave.current = true;
      return;
    }
    persistJson(key, value, trimRef.current);
  }, [key, value]);

  return [value, setValue];
}
