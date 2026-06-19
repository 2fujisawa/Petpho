import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const STYLES = [
  {
    style: "Watercolor",
    description: "Soft, dreamy watercolor illustration",
    prompt:
      "watercolor painting illustration style, soft brushstrokes, pastel colors, artistic watercolor",
  },
  {
    style: "Disney / Pixar",
    description: "Bright, playful Pixar-style character",
    prompt:
      "Disney Pixar 3D animated style, big expressive eyes, smooth 3D render, cute and charming, Pixar movie quality",
  },
  {
    style: "Anime",
    description: "Clean Japanese anime illustration",
    prompt:
      "Japanese anime illustration style, clean linework, vibrant colors, kawaii aesthetic, high quality digital art",
  },
];

async function runWithRetry(
  stylePrompt: string,
  dataUrl: string,
  retries = 2
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await replicate.run("black-forest-labs/flux-kontext-pro", {
        input: {
          prompt: stylePrompt,
          input_image: dataUrl,
          aspect_ratio: "1:1",
          output_format: "jpg",
          safety_tolerance: 2,
        },
      });
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error && err.message.includes("429");
      if (isRateLimit && attempt < retries) {
        await new Promise((r) => setTimeout(r, 12000));
        continue;
      }
      throw err;
    }
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("photo");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  try {
    // Run all 3 styles in parallel
    const outputs = await Promise.all(
      STYLES.map((s) => runWithRetry(s.prompt, dataUrl))
    );

    const results = STYLES.map((s, i) => ({
      style: s.style,
      description: s.description,
      imageUrl: String(outputs[i]),
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Replicate error:", err);
    const message =
      err instanceof Error ? err.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
