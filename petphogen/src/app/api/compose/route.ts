import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import sharp from "sharp";
import { rehostAll } from "@/lib/storage";
import {
  getComposeModelConfig,
  buildComposeImageInput,
  extractImageUrl,
  resolveComposeAspectRatio,
  DEFAULT_COMPOSE_MODEL,
} from "@/lib/models";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sourceImageUrl = formData.get("sourceImageUrl") as string;
  const backgroundPhoto = formData.get("backgroundPhoto");
  const modelId = (formData.get("model") as string) || DEFAULT_COMPOSE_MODEL;
  const aspectRatioChoice = (formData.get("aspectRatio") as string) || "auto";
  const petX = clamp(parseFloat((formData.get("petX") as string) || "50"), 0, 100);
  const petY = clamp(parseFloat((formData.get("petY") as string) || "65"), 0, 100);
  const petScale = clamp(parseFloat((formData.get("petScale") as string) || "35"), 5, 100);

  if (!sourceImageUrl || !(backgroundPhoto instanceof Blob) || backgroundPhoto.size === 0) {
    return NextResponse.json({ error: "Missing source image or background photo" }, { status: 400 });
  }

  const config = getComposeModelConfig(modelId);
  let uploadedComposite: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    const [bgBuffer, petRes] = await Promise.all([
      Buffer.from(await backgroundPhoto.arrayBuffer()),
      fetch(sourceImageUrl),
    ]);
    if (!petRes.ok) throw new Error("Could not load the Pixar pet image");
    const petBuffer = Buffer.from(await petRes.arrayBuffer());

    const bgMeta = await sharp(bgBuffer).metadata();
    const bgWidth = bgMeta.width!;
    const bgHeight = bgMeta.height!;

    const petTargetWidth = Math.round(bgWidth * (petScale / 100));
    const { data: resizedPet, info: petInfo } = await sharp(petBuffer)
      .resize({ width: petTargetWidth })
      .toBuffer({ resolveWithObject: true });

    const left = clamp(
      Math.round((bgWidth * petX) / 100 - petInfo.width / 2),
      0,
      Math.max(0, bgWidth - petInfo.width)
    );
    const top = clamp(
      Math.round((bgHeight * petY) / 100 - petInfo.height / 2),
      0,
      Math.max(0, bgHeight - petInfo.height)
    );

    const compositeBuffer = await sharp(bgBuffer)
      .composite([{ input: resizedPet, left, top }])
      .jpeg({ quality: 92 })
      .toBuffer();

    uploadedComposite = await replicate.files.create(
      new Blob([new Uint8Array(compositeBuffer)], { type: "image/jpeg" })
    );

    const prompt = `The second image shows a Pixar 3D animated character in full detail — preserve its exact appearance, colors, features, and animation style. The first image is a rough placement composite showing that character pasted onto a background scene at a specific position and size. Blend the character into the scene naturally at that exact position and size: add matching lighting and shadows, smooth the edges, and correct perspective so it looks like a single cohesive Pixar movie still. Do not move, resize, or change the pose of the character from where it appears in the first image. Cinematic quality.`;

    const aspectRatio = resolveComposeAspectRatio(config, aspectRatioChoice, bgWidth, bgHeight);

    const output = await replicate.run(config.id as `${string}/${string}`, {
      input: {
        prompt,
        output_format: config.outputFormat,
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...config.extraInput,
        ...buildComposeImageInput(config, [uploadedComposite.urls.get, sourceImageUrl]),
      },
    });

    const images = await rehostAll([extractImageUrl(output)]);
    return NextResponse.json({ images });
  } catch (err) {
    console.error("Compose error:", err);
    const message = err instanceof Error ? err.message : "Compose failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (uploadedComposite) {
      await replicate.files.delete(uploadedComposite.id).catch(() => {});
    }
  }
}
