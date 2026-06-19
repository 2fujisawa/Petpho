import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { getModelConfig, buildImageInput, DEFAULT_MODEL } from "@/lib/models";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function runWithRetry(
  prompt: string,
  imageUrl: string,
  aspectRatio: string,
  modelId: string,
  retries = 2
): Promise<unknown> {
  const config = getModelConfig(modelId);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await replicate.run(modelId as `${string}/${string}`, {
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          output_format: "jpg",
          ...buildImageInput(config, imageUrl),
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
  const { imageUrl, editPrompt, aspectRatio, numOutputs, model: modelId = DEFAULT_MODEL } =
    await req.json();

  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
  }
  if (!editPrompt || typeof editPrompt !== "string" || editPrompt.trim().length === 0) {
    return NextResponse.json({ error: "Edit prompt is required" }, { status: 400 });
  }

  const prompt = `Disney Pixar 3D animated style, ${editPrompt.trim()}, maintain the same character, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, Pixar movie quality`;

  try {
    const runs = Array.from({ length: Math.min(numOutputs || 1, 4) }, () =>
      runWithRetry(prompt, imageUrl, aspectRatio || "1:1", modelId)
    );
    const outputs = await Promise.all(runs);
    const images = outputs.map(String);

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Replicate edit error:", err);
    const message =
      err instanceof Error ? err.message : "Edit generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
