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

    const { url } = await put(filename, buffer, { access: "public", contentType });
    return url;
  } catch {
    return replicateUrl;
  }
}

export async function rehostAll(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(rehost));
}

export async function rehostBuffer(buffer: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  try {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `petpho/uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { url } = await put(filename, buffer, { access: "public", contentType });
    return url;
  } catch {
    return null;
  }
}
