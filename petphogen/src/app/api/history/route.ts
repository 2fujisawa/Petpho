import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

// Lists generated images stored in Blob so history survives across browsers/devices.
export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ images: [] });
  }

  try {
    const images: { url: string; createdAt: number }[] = [];
    let cursor: string | undefined;

    do {
      // Explicit token: with BLOB_STORE_ID set, the SDK otherwise prefers OIDC
      // auth, which is not enabled for local development.
      const res = await list({
        prefix: "petpho/",
        cursor,
        limit: 1000,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      for (const blob of res.blobs) {
        // uploads/ holds source pet photos, not generated results
        if (blob.pathname.startsWith("petpho/uploads/")) continue;
        images.push({
          url: blob.url,
          createdAt: new Date(blob.uploadedAt).getTime(),
        });
      }
      cursor = res.cursor;
    } while (cursor);

    images.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ images });
  } catch (err) {
    console.error("history list failed:", err);
    return NextResponse.json({ images: [] });
  }
}
