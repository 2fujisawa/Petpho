"use client";

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
        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">
          Password
        </label>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          placeholder="Enter access password"
          className={`w-full px-4 py-3 rounded-xl border text-sm transition-all outline-none ${
            error
              ? "border-red-300 bg-red-50 focus:ring-2 focus:ring-red-100"
              : "border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          }`}
          autoComplete="current-password"
        />
        {error && (
          <p className="text-xs text-red-500 font-medium animate-fade-in">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !password.trim()}
        className="w-full py-3 rounded-xl font-bold text-sm text-white bg-orange-400 hover:bg-orange-500 active:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2 mt-1"
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
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm animate-scale-in">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-orange-400 flex items-center justify-center text-2xl shadow-md">
              🐶
            </div>
            <div className="text-center">
              <h1 className="font-extrabold text-2xl tracking-tight text-gray-900">
                PETPHO <span className="text-orange-400">Gen</span>
              </h1>
              <p className="text-sm text-gray-500 mt-1">Admin access required</p>
            </div>
          </div>
          <Suspense fallback={<div className="h-24" />}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">
          Petpho Gen · Admin Tool
        </p>
      </div>
    </main>
  );
}
