"use client";

import Image from "next/image";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        setError("Incorrect password. Try again.");
        setPassword("");
        inputRef.current?.focus();
        return;
      }

      const next = searchParams.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.14em]">
          Password
        </label>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          placeholder="Enter access password"
          className={`w-full px-4 py-3 rounded-xl border text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-600 transition-all duration-200 outline-none ${
            error
              ? "border-red-500/40 bg-red-500/[0.06] focus:ring-2 focus:ring-red-500/15"
              : "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.04] focus:border-orange-400/60 focus:ring-2 focus:ring-orange-400/15"
          }`}
          autoComplete="current-password"
        />
        {error && (
          <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !password.trim()}
        className="btn-primary w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none flex items-center justify-center gap-2 mt-1"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign in →"
        )}
      </button>
    </form>
  );
}

const PAWS = [
  { left: "6%",  size: 22, dur: 19, delay: 0 },
  { left: "16%", size: 14, dur: 24, delay: 6 },
  { left: "29%", size: 18, dur: 21, delay: 11 },
  { left: "44%", size: 13, dur: 26, delay: 3 },
  { left: "58%", size: 20, dur: 18, delay: 14 },
  { left: "71%", size: 15, dur: 23, delay: 8 },
  { left: "84%", size: 24, dur: 20, delay: 1 },
  { left: "93%", size: 14, dur: 27, delay: 16 },
];

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f6f7] dark:bg-[#0f0f11] flex items-center justify-center p-6">
      {/* Ambient drifting glow blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="ambient-blob absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-orange-400/25 dark:bg-orange-500/[0.13] blur-3xl" />
        <div className="ambient-blob b2 absolute -bottom-40 -right-24 w-[460px] h-[460px] rounded-full bg-amber-300/25 dark:bg-amber-400/[0.1] blur-3xl" />
        <div className="ambient-blob b3 absolute top-1/4 left-2/3 w-[380px] h-[380px] rounded-full bg-rose-300/20 dark:bg-rose-400/[0.07] blur-3xl" />
      </div>

      {/* Rising paw prints */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.15] dark:opacity-[0.12]">
        {PAWS.map((p, i) => (
          <span key={i} className="paw-particle"
            style={{ left: p.left, fontSize: p.size, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}>
            🐾
          </span>
        ))}
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        <div className="bg-white/90 dark:bg-[#19191c]/90 backdrop-blur-xl rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_48px_rgba(0,0,0,0.09)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_16px_48px_rgba(0,0,0,0.5)] p-8">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="animate-float logo-glow">
              <Image src="/logo.png" alt="Petpho mascot" width={128} height={128} className="w-28 h-28" priority />
            </div>
            <div className="text-center animate-fade-up" style={{ animationDelay: "120ms" }}>
              <h1 className="font-extrabold text-2xl tracking-tight text-zinc-900 dark:text-white">
                Petpho <span className="text-orange-400">Gen</span>
              </h1>
              <p className="text-sm text-zinc-500 mt-1">Turn your pet into Pixar art</p>
            </div>
          </div>
          <div className="animate-fade-up" style={{ animationDelay: "220ms" }}>
            <Suspense fallback={<div className="h-24" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-700 mt-4 animate-fade-up" style={{ animationDelay: "320ms" }}>
          Petpho Gen · Admin Tool
        </p>
      </div>
    </main>
  );
}
