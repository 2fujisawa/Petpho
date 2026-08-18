import { put } from "@vercel/blob";
import { headers } from "next/headers";

// Every upload lands under this prefix; /api/history lists it and sorts by
// sub-folder. `null` = the generated-image gallery itself.
type Folder = "uploads" | "cutouts" | "originals" | "videos" | null;

// When sharp falls back to its wasm build (as it does on Vercel when the
// native binary fails to load), the Buffers it returns are views onto the
// wasm heap — a SharedArrayBuffer — and undici's fetch rejects request
// bodies backed by shared memory ("ArrayBuffer: SharedArrayBuffer is not
// allowed"). Copy into a fresh, non-shared ArrayBuffer before uploading.
function toPlainBytes(body: Buffer | ArrayBuffer): Buffer | ArrayBuffer {
  return Buffer.isBuffer(body) && body.buffer instanceof SharedArrayBuffer
    ? Buffer.from(body)
    : body;
}

function blobPath(folder: Folder, ext: string): string {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return folder ? `petpho/${folder}/${name}` : `petpho/${name}`;
}

function extFor(contentType: string): string {
  return contentType.includes("png") ? "png" : "jpg";
}

// A single dropped request shouldn't lose work the user just paid a model
// call for: run `fn` up to `attempts` times with a short, growing pause.
async function retry<T>(attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 400));
    }
  }
  throw lastErr;
}

// Where the OIDC token lives depends on *where the code is running*, and this
// is the detail that silently breaks Blob in production:
//   - builds and local dev (after `vercel env pull`) get VERCEL_OIDC_TOKEN in
//     the environment;
//   - a running Function does NOT. Vercel puts the token on the request as the
//     `x-vercel-oidc-token` header instead.
// next/headers reads the current request's headers, so this resolves correctly
// in both places. It throws outside a request scope (a build, a script), which
// is exactly when the environment variable is the right answer anyway.
async function oidcToken(): Promise<string | undefined> {
  const fromEnv = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return (await headers()).get("x-vercel-oidc-token")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Credentials for a Blob call.
//
// The SDK resolves auth in this order: an explicit `token`, then OIDC
// (oidcToken + storeId), then process.env.BLOB_READ_WRITE_TOKEN. An explicit
// token *always* wins — including over OIDC — so it is only passed when one is
// actually set. That leaves OIDC as the normal path (it rotates on its own, so
// there is no long-lived secret to leak) while a static token still works as a
// fallback for anything running off Vercel.
export async function blobAuth(): Promise<
  { token: string } | { oidcToken: string; storeId: string } | Record<string, never>
> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const oidc = await oidcToken();
  const storeId = process.env.BLOB_STORE_ID?.trim();
  return oidc && storeId ? { oidcToken: oidc, storeId } : {};
}

// True when at least one credential path is actually usable right now.
export async function storageConfigured(): Promise<boolean> {
  return Object.keys(await blobAuth()).length > 0;
}

// The one place that talks to Blob.
async function putBlob(pathname: string, body: Buffer | ArrayBuffer, contentType: string) {
  const auth = await blobAuth();
  if (Object.keys(auth).length === 0) {
    throw new Error(
      "Storage is not configured — needs either OIDC (connect the Blob store to this " +
        "project, then run `vercel env pull`) or BLOB_READ_WRITE_TOKEN."
    );
  }
  const { url } = await put(pathname, toPlainBytes(body), {
    access: "public",
    contentType,
    ...auth,
  });
  return url;
}

// Copies a freshly generated image out of Replicate and into Blob.
//
// This matters more than it looks: Replicate's own output URLs expire after
// about an hour. Any time this falls back to returning the Replicate URL, the
// client happily saves it to history as though it were permanent, and it turns
// into a dead "Expired" card that can never be recovered — the bytes are gone.
// So: retry before giving up, and always say loudly when it didn't work.
export async function rehost(replicateUrl: string): Promise<string> {
  if (!(await storageConfigured())) {
    console.error("rehost: storage not configured — image will expire in ~1h");
    return replicateUrl;
  }
  try {
    return await retry(3, async () => {
      const res = await fetch(replicateUrl);
      if (!res.ok) throw new Error(`source fetch failed: ${res.status}`);
      const contentType = res.headers.get("content-type") || "image/jpeg";
      return putBlob(blobPath(null, extFor(contentType)), await res.arrayBuffer(), contentType);
    });
  } catch (err) {
    console.error(
      `rehost: FAILED to archive ${replicateUrl} after 3 attempts — this image will ` +
        `expire in ~1h and show as "Expired".`,
      err
    );
    return replicateUrl;
  }
}

export async function rehostAll(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(rehost));
}

// Videos get their own prefix so /api/history can list them separately, and so
// an .mp4 can never fall through into the image gallery. The extension is
// fixed rather than derived — Seedance always returns MP4, and a video
// mislabelled .jpg won't play in a <video> tag.
// `archived` false means the clip is playable right now but will expire — the
// caller passes that on so the UI can say so instead of silently handing the
// user a link that dies within the hour.
export async function rehostVideo(
  replicateUrl: string
): Promise<{ url: string; archived: boolean }> {
  if (!(await storageConfigured())) {
    console.error("rehostVideo: storage not configured — clip will expire");
    return { url: replicateUrl, archived: false };
  }
  try {
    const url = await retry(3, async () => {
      const res = await fetch(replicateUrl);
      if (!res.ok) throw new Error(`source fetch failed: ${res.status}`);
      return putBlob(
        blobPath("videos", "mp4"),
        await res.arrayBuffer(),
        res.headers.get("content-type") || "video/mp4"
      );
    });
    return { url, archived: true };
  } catch (err) {
    console.error("rehostVideo: FAILED to archive after 3 attempts — clip will expire", err);
    return { url: replicateUrl, archived: false };
  }
}

// Stores working artefacts (source uploads, cutouts) in a sub-folder so they
// stay out of the generated-image gallery. Throws with the real reason —
// callers whose whole job is the upload should let that reach the user.
export async function putBuffer(
  buffer: Buffer,
  contentType: string,
  folder: Exclude<Folder, "videos" | null> = "uploads"
): Promise<string> {
  const pathname = blobPath(folder, extFor(contentType));
  const sizeMb = (buffer.length / 1048576).toFixed(2);
  try {
    return await retry(2, () => putBlob(pathname, buffer, contentType));
  } catch (err) {
    console.error(`putBuffer: failed for ${pathname} (${sizeMb}MB, ${contentType})`, err);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Upload to storage failed (${sizeMb}MB): ${detail}`);
  }
}

// putBuffer for callers that can carry on without the upload — returns null
// instead of throwing (the failure is already logged by putBuffer).
export async function rehostBuffer(
  buffer: Buffer,
  contentType: string,
  folder: Exclude<Folder, "videos" | null> = "uploads"
): Promise<string | null> {
  try {
    return await putBuffer(buffer, contentType, folder);
  } catch {
    return null;
  }
}

// Same top-level path as rehost() (so it shows up in /api/history like any
// other generated result), but takes an already-in-memory buffer instead of
// fetching a source URL — for results transformed locally (e.g. resized)
// before storing. Returns null on failure so the caller can fall back to the
// un-transformed original.
export async function rehostGeneratedBuffer(
  buffer: Buffer,
  contentType: string
): Promise<string | null> {
  try {
    return await putBlob(blobPath(null, extFor(contentType)), buffer, contentType);
  } catch {
    return null;
  }
}
