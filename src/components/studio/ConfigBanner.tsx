"use client";

import type { ConfigIssue } from "@/types/studio";

// Shown at the top of the studio when the deployment can't actually do its
// job. The point is to say so *before* someone uploads a photo and waits —
// a credential problem used to surface only as a raw provider error part-way
// through a generation the user had already paid for.
export function ConfigBanner({ issues }: { issues: ConfigIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex-shrink-0 mx-6 mt-5 rounded-2xl border border-amber-400/50 bg-amber-50 px-4 py-3 animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-base leading-none mt-px">⚠️</span>
        <div className="min-w-0 flex flex-col gap-1.5">
          <p className="text-[13px] font-bold text-amber-900">
            {issues.length === 1
              ? "This deployment isn’t fully configured"
              : `${issues.length} configuration problems`}
          </p>
          {issues.map((issue) => (
            <p key={issue.key} className="text-xs text-amber-900/85 leading-relaxed">
              {issue.message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
