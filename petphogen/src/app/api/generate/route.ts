import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { getModelConfig, buildImageInput, DEFAULT_MODEL } from "@/lib/models";
import { rehostAll } from "@/lib/storage";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

async function runWithRetry(
  prompt: string,
  dataUrl: string,
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
          ...buildImageInput(config, dataUrl),
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
  const prompt = formData.get("prompt");
  const aspectRatio = (formData.get("aspectRatio") as string) || "1:1";
  const numOutputs = parseInt((formData.get("numOutputs") as string) || "1");
  const modelId = (formData.get("model") as string) || DEFAULT_MODEL;
  const backgroundPhoto = formData.get("backgroundPhoto");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Photo must be under 8 MB" }, { status: 400 });
  }

  const mimeType = file.type || "image/jpeg";
  const buffer = Buffer.from(await file.arrayBuffer());

  const promptText = prompt
    ? `Disney Pixar 3D animated style, ${String(prompt).trim()}, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, cute and charming, Pixar movie quality`
    : "Transform into Disney Pixar 3D animated style, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, cute and charming, Pixar movie quality";

  let uploadedFile: Awaited<ReturnType<typeof replicate.files.create>> | null = null;
  let uploadedBackground: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    uploadedFile = await replicate.files.create(
      new Blob([buffer], { type: mimeType })
    );
    const imageUrl = uploadedFile.urls.get;

    // Two-image flow: pet photo + uploaded background image
    if (backgroundPhoto instanceof Blob && backgroundPhoto.size > 0) {
      const bgBuffer = Buffer.from(await backgroundPhoto.arrayBuffer());
      uploadedBackground = await replicate.files.create(
        new Blob([bgBuffer], { type: backgroundPhoto.type || "image/jpeg" })
      );

      const bgPrompt = `Disney Pixar 3D animated style. Take the pet animal from the first image and transform it into a Pixar 3D animated character with big expressive eyes, smooth render, and vibrant colors. Place the Pixar pet sitting naturally inside the scene shown in the second image. Keep the background exactly as shown in the second image. Cinematic lighting, Pixar movie quality.`;

      const runs = Array.from({ length: Math.min(numOutputs, 4) }, () =>
        replicate.run("google/nano-banana" as `${string}/${string}`, {
          input: {
            image_input: [imageUrl, uploadedBackground!.urls.get],
            prompt: bgPrompt,
            aspect_ratio: aspectRatio,
            output_format: "jpg",
          },
        })
      );
      const outputs = await Promise.all(runs);
      const images = await rehostAll(outputs.map(String));
      return NextResponse.json({ images });
    }

    // Normal single-image flow
    const runs = Array.from({ length: Math.min(numOutputs, 4) }, () =>
      runWithRetry(promptText, imageUrl, aspectRatio, modelId)
    );
    const outputs = await Promise.all(runs);
    const images = await rehostAll(outputs.map(String));

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Replicate error:", err);
    const message =
      err instanceof Error ? err.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await Promise.all([
      uploadedFile && replicate.files.delete(uploadedFile.id).catch(() => {}),
      uploadedBackground && replicate.files.delete(uploadedBackground.id).catch(() => {}),
    ]);
  }
}
