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
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Blob delete error:", err);
    return NextResponse.json({ ok: true, skipped: true });
  }
}
