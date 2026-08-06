import { put } from "@vercel/blob";

export async function rehost(replicateUrl: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return replicateUrl;

  try {
    const res = await fetch(replicateUrl);
    if (!res.ok) return replicateUrl;

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `petpho/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Explicit token: with BLOB_STORE_ID set, the SDK otherwise prefers OIDC
    // auth, which is not enabled for local development.
    const { url } = await put(filename, buffer, {
      access: "public",
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return url;
  } catch {
    return replicateUrl;
  }
}

export async function rehostAll(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(rehost));
}

// `folder` keeps working artefacts (source uploads, cutouts) out of the
// generated-image gallery — /api/history skips these prefixes.
// Throws with the real reason. Callers that can carry on without the upload
// should use rehostBuffer; callers whose whole job is the upload should use
// this so the actual failure reaches the user instead of a generic message.
export async function putBuffer(
  buffer: Buffer,
  contentType: string,
  folder: "uploads" | "cutouts" = "uploads"
): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Storage is not configured (BLOB_READ_WRITE_TOKEN is missing)");
  }

  const ext = contentType.includes("png") ? "png" : "jpg";
  const filename = `petpho/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const sizeMb = (buffer.length / 1048576).toFixed(2);

  // One retry: a single dropped upload shouldn't lose work the user just paid
  // a model call for.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { url } = await put(filename, buffer, {
        access: "public",
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return url;
    } catch (err) {
      lastErr = err;
      console.error(
        `putBuffer: attempt ${attempt} failed for ${filename} (${sizeMb}MB, ${contentType})`,
        err
      );
      if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
    }
  }

  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Upload to storage failed (${sizeMb}MB): ${detail}`);
}

export async function rehostBuffer(
  buffer: Buffer,
  contentType: string,
  folder: "uploads" | "cutouts" = "uploads"
): Promise<string | null> {
  try {
    return await putBuffer(buffer, contentType, folder);
  } catch (err) {
    // Swallowing this used to make upload failures indistinguishable from a
    // missing token — always say what actually went wrong.
    console.error("rehostBuffer:", err);
    return null;
  }
}
