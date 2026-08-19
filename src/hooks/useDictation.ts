"use client";

import { useRef, useState } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

// One-shot browser speech-to-text for the prompt boxes. `toggle` starts
// listening, or stops the recognition already in flight; `onUnsupported`
// fires where the Web Speech API is missing (Firefox, some WebViews).
export function useDictation() {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  function toggle(onText: (text: string) => void, onUnsupported: () => void) {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
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

  return { listening, toggle };
}
