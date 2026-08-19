import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { blobAuth, storageConfigured } from "@/lib/storage";

// Lists generated images stored in Blob so history survives across browsers/devices.
// Also returns the original pet photos that were uploaded to produce them, so
// they can be reused later from any browser — the client's own uploadUrl only
// lives in localStorage and is lost on a different device.
export async function GET() {
  if (!(await storageConfigured())) {
    return NextResponse.json({ images: [], uploads: [], videos: [] });
  }

  try {
    const images: { url: string; createdAt: number }[] = [];
    const uploads: { url: string; createdAt: number }[] = [];
    const videos: { url: string; createdAt: number }[] = [];
    let cursor: string | undefined;

    do {
      const res = await list({ prefix: "petpho/", cursor, limit: 1000, ...(await blobAuth()) });
      for (const blob of res.blobs) {
        const createdAt = new Date(blob.uploadedAt).getTime();
        // originals/ holds the real reference photos at full size — the only
        // thing the Originals tab should show.
        if (blob.pathname.startsWith("petpho/originals/")) {
          uploads.push({ url: blob.url, createdAt });
          continue;
        }
        // uploads/ is the legacy archive: downscaled, aspect-padded canvases
        // rather than the photo the user actually picked. Kept on disk, but not
        // surfaced as an "original" because it isn't one.
        if (blob.pathname.startsWith("petpho/uploads/")) continue;
        // cutouts/ holds background-removed working copies — internal only
        if (blob.pathname.startsWith("petpho/cutouts/")) continue;
        // videos/ is its own tab; an .mp4 in the image grid would render as a
        // permanently broken thumbnail.
        if (blob.pathname.startsWith("petpho/videos/")) {
          videos.push({ url: blob.url, createdAt });
          continue;
        }
        images.push({ url: blob.url, createdAt });
      }
      cursor = res.cursor;
    } while (cursor);

    images.sort((a, b) => b.createdAt - a.createdAt);
    uploads.sort((a, b) => b.createdAt - a.createdAt);
    videos.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ images, uploads, videos });
  } catch (err) {
    console.error("history list failed:", err);
    return NextResponse.json({ images: [], uploads: [], videos: [] });
  }
}
