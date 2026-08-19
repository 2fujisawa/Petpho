import type Replicate from "replicate";
import { ConfigError, rejectedMessage } from "./env";

// Replicate reports upstream capacity problems as a *failed prediction*, not an
// HTTP status — by the time it reaches us it's a plain Error whose message is
// the provider's text. So matching on the message is the only option.
//
// "ModelRateLimitError ... (E003)" is Google's and OpenAI's "we're full right
// now"; it clears on its own within seconds to a minute. That's categorically
// different from a rejected prompt or a bad input, which will fail identically
// no matter how many times we ask — so only these get retried.
const TRANSIENT =
  /ModelRateLimitError|E003|high demand|at capacity|overloaded|rate.?limit|\b(429|502|503|504)\b|temporarily unavailable|try again later/i;

export function isTransientModelError(err: unknown): boolean {
  return err instanceof Error && TRANSIENT.test(err.message);
}

// A credential the provider refused. Deliberately separate from TRANSIENT:
// retrying a rejected token just burns time, and the fix is a configuration
// change, not a wait. Replicate reports these as a plain Error whose message
// carries the HTTP status, so matching the message is the only option.
const AUTH =
  /\b(401|403)\b|Unauthorized|Invalid token|authentication failed|invalid api (key|token)/i;

export function isAuthError(err: unknown): boolean {
  return err instanceof Error && AUTH.test(err.message);
}

// Each layer (Replicate SDK, prediction poller, provider) prepends its own
// "…failed:" prefix, so the raw message arrives as "Prediction failed:
// Prediction failed: Async prediction failed: ModelRateLimitError: …". Strip
// the stack and, for the capacity case, say what the user can actually do.
export function describeModelError(err: unknown, modelName: string): string {
  const raw = err instanceof Error ? err.message : "Something went wrong";
  // Already a written-for-humans configuration message — pass it straight on.
  if (err instanceof ConfigError) return err.message;
  // Otherwise the raw text is an SDK dump ("Request to https://api.replicate.com/
  // v1/files failed with status 401 Unauthorized: {"detail":"Invalid token"}"),
  // which tells the reader nothing about what to change.
  if (isAuthError(err)) return rejectedMessage("REPLICATE_API_TOKEN");
  if (isTransientModelError(err)) {
    return (
      `${modelName} is busy right now — the model provider is at capacity, so this isn't ` +
      `a problem with your photo or settings. We already retried a few times. ` +
      `Wait a minute and try again, or switch to another model.`
    );
  }
  const cleaned = raw
    .replace(/^(\s*(Async\s+)?[Pp]rediction failed:\s*)+/, "")
    .trim();
  return cleaned || raw;
}

// Wraps replicate.run with backoff on transient provider failures. Retries only
// fire on a *failed* prediction, so a retry is a fresh attempt rather than a
// duplicate of work that already succeeded.
export async function runModel(
  replicate: Replicate,
  modelId: string,
  input: Record<string, unknown>,
  { retries = 2 }: { retries?: number } = {}
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await replicate.run(modelId as `${string}/${string}`, { input });
    } catch (err) {
      if (attempt >= retries || !isTransientModelError(err)) throw err;
      // 4s then 10s. Long enough for a capacity spike to drain, short enough
      // that the user isn't left staring at a spinner for minutes.
      const waitMs = attempt === 0 ? 4000 : 10000;
      console.warn(
        `${modelId} at capacity, retrying in ${waitMs / 1000}s (attempt ${attempt + 2}/${retries + 1})`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
