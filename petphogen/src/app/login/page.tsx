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

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[#f6f6f7] dark:bg-[#0f0f11] flex items-center justify-center p-6">
      <div className="w-full max-w-sm animate-scale-in">
        <div className="bg-white dark:bg-[#19191c] rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_48px_rgba(0,0,0,0.09)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_16px_48px_rgba(0,0,0,0.5)] p-8">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="animate-float logo-glow">
              <Image src="/logo.png" alt="Petpho mascot" width={128} height={128} className="w-28 h-28" priority />
            </div>
            <div className="text-center">
              <h1 className="font-extrabold text-2xl tracking-tight text-zinc-900 dark:text-white">
                Petpho <span className="text-orange-400">Gen</span>
              </h1>
              <p className="text-sm text-zinc-500 mt-1">Admin access required</p>
            </div>
          </div>
          <Suspense fallback={<div className="h-24" />}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-700 mt-4">
          Petpho Gen · Admin Tool
        </p>
      </div>
    </main>
  );
}
