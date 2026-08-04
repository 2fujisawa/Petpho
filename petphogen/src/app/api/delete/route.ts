import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "No url provided" }, { status: 400 });
  }

  // Only delete blobs we actually host — ignore stray/expired Replicate URLs.
  if (!url.includes(".public.blob.vercel-storage.com/")) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    // Explicit token: with BLOB_STORE_ID set, the SDK otherwise prefers OIDC
    // auth, which is not enabled for local development.
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Blob delete error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
