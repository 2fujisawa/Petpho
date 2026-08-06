import { NextRequest, NextResponse } from "next/server";
import { putBuffer } from "@/lib/storage";

// Stores a hand-refined cutout (brushed in the browser) so compose can
// reference it by URL like any other image.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image");

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Must stay PNG — the whole point is the alpha channel.
    const url = await putBuffer(buffer, "image/png", "cutouts");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Cutout upload error:", err);
    const message = err instanceof Error ? err.message : "Could not save the cutout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
