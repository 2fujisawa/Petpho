import Replicate from "replicate";
import { requireEnv } from "./env";

// Lazily built so a missing token throws a ConfigError at the top of a request
// — with a message that says what to set and where — instead of constructing a
// client with `auth: undefined` that fails much later inside a model call.
let client: Replicate | null = null;

export function getReplicate(): Replicate {
  const auth = requireEnv("REPLICATE_API_TOKEN");
  if (!client) client = new Replicate({ auth });
  return client;
}
