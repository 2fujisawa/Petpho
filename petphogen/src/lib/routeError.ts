import { NextResponse } from "next/server";
import { ConfigError } from "./env";
import { describeModelError, isAuthError } from "./replicateRun";

// One error shape for every model-backed route.
//
// A missing or rejected credential is a 503, not a 500: the server is
// reachable and the request was fine, the deployment just isn't configured.
// That distinction matters to whoever is reading the logs at 2am.
export function errorResponse(err: unknown, label: string): NextResponse {
  const misconfigured = err instanceof ConfigError || isAuthError(err);
  return NextResponse.json(
    { error: describeModelError(err, label) },
    { status: misconfigured ? 503 : 500 }
  );
}
