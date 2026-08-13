import { put } from "@vercel/blob";

// Copies a freshly generated image out of Replicate and into Blob.
//
// This matters more than it looks: Replicate's own output URLs expire after
// about an hour. Any time this falls back to returning the Replicate URL, the
// client happily saves it to history as though it were permanent, and it turns
// into a dead "Expired" card that can never be recovered — the bytes are gone.
// So: retry before giving up, and always say loudly when it didn't work, rather
// than failing silently the way this used to.
export async function rehost(replicateUrl: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("rehost: BLOB_READ_WRITE_TOKEN missing — image will expire in ~1h");
    return replicateUrl;
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(replicateUrl);
      if (!res.ok) throw new Error(`source fetch failed: ${res.status}`);

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
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }

  console.error(
    `rehost: FAILED to archive ${replicateUrl} after 3 attempts — this image will ` +
      `expire in ~1h and show as "Expired".`,
    lastErr
  );
  return replicateUrl;
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
  folder: "uploads" | "cutouts" | "originals" = "uploads"
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

// Same top-level path scheme as rehost() (so it shows up in /api/history like
// any other generated result, unlike putBuffer's uploads/cutouts subfolders),
// but takes an already-in-memory buffer instead of fetching a source URL —
// for results that were transformed locally (e.g. resized) before storing.
export async function rehostGeneratedBuffer(buffer: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `petpho/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

// Videos get their own prefix so /api/history can list them separately, and so
// an .mp4 can never fall through into the image gallery. Unlike rehost(), the
// extension is fixed rather than derived — Seedance always returns MP4, and a
// video mislabelled .jpg won't play in a <video> tag.
// `archived` false means the clip is playable right now but will expire — the
// caller passes that on so the UI can say so instead of silently handing the
// user a link that dies within the hour.
export async function rehostVideo(
  replicateUrl: string
): Promise<{ url: string; archived: boolean }> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(replicateUrl);
        if (!res.ok) throw new Error(`source fetch failed: ${res.status}`);

        const buffer = await res.arrayBuffer();
        const filename = `petpho/videos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
        const { url } = await put(filename, buffer, {
          access: "public",
          contentType: res.headers.get("content-type") || "video/mp4",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        return { url, archived: true };
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
    console.error(`rehostVideo: FAILED to archive after 3 attempts — clip will expire`, lastErr);
  } else {
    console.error("rehostVideo: BLOB_READ_WRITE_TOKEN missing — clip will expire");
  }

  return { url: replicateUrl, archived: false };
}

export async function rehostBuffer(
  buffer: Buffer,
  contentType: string,
  folder: "uploads" | "cutouts" | "originals" = "uploads"
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
