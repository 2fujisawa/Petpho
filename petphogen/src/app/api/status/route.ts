import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { checkConfig, rejectedMessage, storageMissingMessage, type ConfigIssue } from "@/lib/env";
import { blobAuth, storageConfigured } from "@/lib/storage";

// Reports whether this deployment is actually able to do its job, so the
// studio can say so on load rather than letting someone upload a photo, wait,
// and then meet a raw provider error.
//
// Never returns a secret — only which key is wrong and what to do about it.
// Sits behind the auth gate like every other /api route.

// A well-formed token can still be revoked, and shape checks can't see that,
// so each credential is exercised against its provider. Cached per instance:
// this runs on every studio load and the answer changes about once a year.
const TTL_MS = 60_000;
let cached: { at: number; issues: ConfigIssue[] } | null = null;

async function rejects(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 401 || res.status === 403;
  } catch {
    // A timeout or network blip is not proof the credential is bad — don't
    // cry misconfiguration over a flaky moment.
    return false;
  }
}

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ issues: cached.issues });
  }

  const issues = checkConfig();
  const brokenKeys = new Set(issues.map((i) => i.key));

  // Resolved per-request: in a Function the OIDC token is a request header, not
  // an environment variable, so this cannot be answered by checkConfig().
  const hasStorage = await storageConfigured();
  if (!hasStorage) {
    issues.push({
      key: "BLOB_READ_WRITE_TOKEN",
      feature: "Saving results to permanent storage",
      problem: "missing",
      message: storageMissingMessage(),
    });
    brokenKeys.add("BLOB_READ_WRITE_TOKEN");
  }

  type Rejected = { key: "REPLICATE_API_TOKEN" | "BLOB_READ_WRITE_TOKEN"; feature: string };
  const ok: Promise<Rejected | null> = Promise.resolve(null);

  const live = await Promise.all([
    brokenKeys.has("REPLICATE_API_TOKEN")
      ? ok
      : rejects("https://api.replicate.com/v1/account", process.env.REPLICATE_API_TOKEN!).then(
          (bad): Rejected | null =>
            bad ? { key: "REPLICATE_API_TOKEN", feature: "Image and video generation" } : null
        ),
    // Goes through the SDK rather than a bare bearer request, so it exercises
    // whichever credential is actually in play — OIDC or a static token.
    brokenKeys.has("BLOB_READ_WRITE_TOKEN")
      ? ok
      : list({ limit: 1, ...(await blobAuth()) }).then(
          (): Rejected | null => null,
          (): Rejected | null => ({
            key: "BLOB_READ_WRITE_TOKEN",
            feature: "Saving results to permanent storage",
          })
        ),
  ]);

  for (const result of live) {
    if (!result) continue;
    issues.push({
      key: result.key,
      feature: result.feature,
      problem: "rejected",
      message: rejectedMessage(result.key),
    });
  }

  cached = { at: Date.now(), issues };
  return NextResponse.json({ issues });
}
