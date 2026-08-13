import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { getModelConfig, buildImageInput, extractImageUrl, resolveResolution, DEFAULT_MODEL } from "@/lib/models";
import { rehostAll, rehostBuffer } from "@/lib/storage";
import { runModel, describeModelError } from "@/lib/replicateRun";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Retry/backoff lives in runModel — this used to match only on "429", which
// never fires for the capacity failure providers actually send back
// ("ModelRateLimitError … E003"), so the retry was effectively dead code.
function runOne(
  prompt: string,
  dataUrl: string,
  aspectRatio: string,
  modelId: string,
  resolutionChoice: string | undefined
): Promise<unknown> {
  const config = getModelConfig(modelId);
  // Omitted entirely for models with no resolution control, so we never send
  // a param they'd reject.
  const resolution = resolveResolution(config, resolutionChoice);

  return runModel(replicate, modelId, {
    prompt,
    aspect_ratio: aspectRatio,
    output_format: config.outputFormat,
    ...(resolution ? { resolution } : {}),
    ...config.extraInput,
    ...buildImageInput(config, dataUrl),
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("photo");
  const prompt = formData.get("prompt");
  const aspectRatio = (formData.get("aspectRatio") as string) || "1:1";
  // A blank or non-numeric value used to yield NaN, which made Array.from
  // produce an empty run list — a 200 response with zero images and no error.
  const requestedOutputs = Number.parseInt(String(formData.get("numOutputs") ?? "1"), 10);
  const numOutputs = Number.isFinite(requestedOutputs)
    ? Math.min(Math.max(requestedOutputs, 1), 4)
    : 1;
  const modelId = (formData.get("model") as string) || DEFAULT_MODEL;
  const resolution = (formData.get("resolution") as string) || undefined;
  const backgroundPhoto = formData.get("backgroundPhoto");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Photo must be under 8 MB" }, { status: 400 });
  }

  const mimeType = file.type || "image/jpeg";
  const buffer = Buffer.from(await file.arrayBuffer());

  // What gets kept in the Originals library. The `photo` field has already been
  // downscaled and padded onto an aspect-ratio canvas for the model, so archive
  // the untouched upload when the client sends it and only fall back otherwise.
  const originalPhoto = formData.get("originalPhoto");
  const hasOriginal =
    originalPhoto instanceof Blob &&
    originalPhoto.size > 0 &&
    originalPhoto.size <= 12 * 1024 * 1024;
  const archiveBuffer = hasOriginal
    ? Buffer.from(await (originalPhoto as Blob).arrayBuffer())
    : buffer;
  const archiveType = hasOriginal ? (originalPhoto as Blob).type || "image/jpeg" : mimeType;

  const promptText = prompt
    ? `Disney Pixar 3D animated style, ${String(prompt).trim()}, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, cute and charming, Pixar movie quality`
    : "Transform into Disney Pixar 3D animated style, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, cute and charming, Pixar movie quality";

  let uploadedFile: Awaited<ReturnType<typeof replicate.files.create>> | null = null;
  let uploadedBackground: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    const [uploadedFileResult, uploadUrl] = await Promise.all([
      replicate.files.create(new Blob([buffer], { type: mimeType })),
      // Genuine full-size reference photos go in originals/. Without one, all
      // we have is the padded canvas built for the model — still worth keeping,
      // but it isn't the user's photo, so it stays out of the Originals tab.
      rehostBuffer(archiveBuffer, archiveType, hasOriginal ? "originals" : "uploads"),
    ]);
    uploadedFile = uploadedFileResult;
    const imageUrl = uploadedFile.urls.get;

    // Two-image flow: pet photo + uploaded background image
    if (backgroundPhoto instanceof Blob && backgroundPhoto.size > 0) {
      const bgBuffer = Buffer.from(await backgroundPhoto.arrayBuffer());
      uploadedBackground = await replicate.files.create(
        new Blob([bgBuffer], { type: backgroundPhoto.type || "image/jpeg" })
      );

      const bgPrompt = `Disney Pixar 3D animated style. Take the pet animal from the first image and transform it into a Pixar 3D animated character with big expressive eyes, smooth render, and vibrant colors. Place the Pixar pet sitting naturally inside the scene shown in the second image. Keep the background exactly as shown in the second image. Cinematic lighting, Pixar movie quality.`;

      const runs = Array.from({ length: numOutputs }, () =>
        runModel(replicate, "google/nano-banana", {
          image_input: [imageUrl, uploadedBackground!.urls.get],
          prompt: bgPrompt,
          aspect_ratio: aspectRatio,
          output_format: "jpg",
        })
      );
      const outputs = await Promise.all(runs);
      const images = await rehostAll(outputs.map(String));
      return NextResponse.json({ images, uploadUrl });
    }

    // Normal single-image flow
    const runs = Array.from({ length: numOutputs }, () =>
      runOne(promptText, imageUrl, aspectRatio, modelId, resolution)
    );
    const outputs = await Promise.all(runs);
    const images = await rehostAll(outputs.map(extractImageUrl));

    return NextResponse.json({ images, uploadUrl });
  } catch (err) {
    console.error("Replicate error:", err);
    const message = describeModelError(err, getModelConfig(modelId).name);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await Promise.all([
      uploadedFile && replicate.files.delete(uploadedFile.id).catch(() => {}),
      uploadedBackground && replicate.files.delete(uploadedBackground.id).catch(() => {}),
    ]);
  }
}
