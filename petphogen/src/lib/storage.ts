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
export async function rehostBuffer(
  buffer: Buffer,
  contentType: string,
  folder: "uploads" | "cutouts" = "uploads"
): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  try {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `petpho/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { url } = await put(filename, buffer, {
      access: "public",
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return url;
  } catch {
    return null;
  }
}
