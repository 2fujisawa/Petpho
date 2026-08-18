// Server-side configuration. One place that knows which environment variables
// the app needs, what a valid one looks like, and how to fix a broken one —
// so a misconfiguration surfaces as a sentence the reader can act on instead
// of a raw API error from three layers down.

import type { ConfigIssue } from "@/types/studio";

export type { ConfigIssue };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type EnvKey = "REPLICATE_API_TOKEN" | "BLOB_READ_WRITE_TOKEN" | "ADMIN_PASSWORD";

type Spec = {
  // What breaks without it, in the user's terms.
  feature: string;
  // Expected prefix, where the provider issues a recognisable one. A value
  // that doesn't match is almost always a copy/paste of the wrong secret.
  prefix?: string;
  // How to obtain a valid value, as a complete sentence — these differ too
  // much in kind (a URL, a dashboard path, "pick one") to slot into a shared
  // template without reading badly.
  how: string;
  // Only validated when actually set. Storage, for instance, normally
  // authenticates via OIDC and needs no static token at all.
  optional?: boolean;
};

const SPECS: Record<EnvKey, Spec> = {
  REPLICATE_API_TOKEN: {
    feature: "Image and video generation",
    prefix: "r8_",
    how: "Create one at https://replicate.com/account/api-tokens.",
  },
  BLOB_READ_WRITE_TOKEN: {
    feature: "Saving results to permanent storage",
    prefix: "vercel_blob_rw_",
    how: "Only needed off Vercel — on Vercel, OIDC handles this.",
    optional: true,
  },
  ADMIN_PASSWORD: {
    feature: "Signing in",
    how: "Choose a strong value and use the same one in every environment.",
  },
};

// Where to put the value, phrased for whichever environment is running.
function location(): string {
  return process.env.VERCEL
    ? "Vercel → Settings → Environment Variables (then redeploy)"
    : ".env.local (then restart the dev server)";
}

function inspect(key: EnvKey): ConfigIssue | null {
  const spec = SPECS[key];
  const raw = process.env[key];

  if (!raw || !raw.trim()) {
    if (spec.optional) return null;
    return {
      key,
      feature: spec.feature,
      problem: "missing",
      message: `${spec.feature} is unavailable: ${key} is not set. Add it in ${location()}. ${spec.how}`,
    };
  }
  if (spec.prefix && !raw.startsWith(spec.prefix)) {
    return {
      key,
      feature: spec.feature,
      problem: "malformed",
      message: `${key} doesn't look like a valid value — it should start with "${spec.prefix}". Check you copied the right secret into ${location()}.`,
    };
  }
  return null;
}

// Returns the value, or throws a ConfigError whose message says what to do.
// Call this at the top of a route so the request fails immediately, before any
// upload or model call, rather than part-way through the work.
export function requireEnv(key: EnvKey): string {
  const issue = inspect(key);
  if (issue) throw new ConfigError(issue.message);
  return process.env[key]!;
}

// Everything wrong with the current environment, for the status endpoint.
// Checks shape only — no network calls, no secret values ever returned.
export function checkConfig(): ConfigIssue[] {
  return (Object.keys(SPECS) as EnvKey[])
    .map(inspect)
    .filter((i): i is ConfigIssue => i !== null);
}

// Message for a credential the provider actively rejected. Shape can't catch
// this — a revoked or rotated token is perfectly well-formed.
export function rejectedMessage(key: EnvKey): string {
  const spec = SPECS[key];
  return `${spec.feature} is unavailable: ${key} was rejected — it's set, but no longer valid (usually revoked or rotated). ${spec.how} Update it in ${location()}.`;
}

// Storage is the one capability with two possible credential paths, and the
// live one can only be resolved inside a request (the OIDC token arrives as a
// header in Functions), so the check itself lives in /api/status.
export function storageMissingMessage(): string {
  return (
    "Saving results to permanent storage is unavailable: no Blob credentials found. " +
    "Connect the Blob store to this project (Vercel → Storage → your store → Projects → " +
    "Connect to Project, including this environment) and redeploy. Without it, generated " +
    "images fall back to Replicate URLs that expire in about an hour."
  );
}
