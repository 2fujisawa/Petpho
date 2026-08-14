import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import {
  getModelConfig,
  buildImageInput,
  extractImageUrl,
  resolveResolution,
  DEFAULT_MODEL,
  COMPOSE_MODELS,
  getComposeModelConfig,
  buildComposeImageInput,
  type ModelConfig,
} from "@/lib/models";
import { getStyleConfig, buildStylePrompt, buildStyleBackgroundPrompt } from "@/lib/styles";
import { rehostAll, rehostBuffer } from "@/lib/storage";
import { runModel, describeModelError, isTransientModelError } from "@/lib/replicateRun";

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
    ...(resolution ? { [config.resolutionParam ?? "resolution"]: resolution } : {}),
    ...config.extraInput,
    ...buildImageInput(config, dataUrl),
  });
}

// When a provider is at capacity (E003 etc.) even after runModel's retries,
// rerun the job once on a model from a *different* provider — capacity crunches
// are provider-wide, so retrying a sibling model from the same provider
// (nano-banana for nano-banana-pro) would just fail the same way.
function fallbackModelId(primaryId: string): string {
  return primaryId === "openai/gpt-image-2"
    ? "black-forest-labs/flux-kontext-pro"
    : "openai/gpt-image-2";
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
  const style = getStyleConfig(formData.get("style") as string | null);
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

  const promptText = buildStylePrompt(style, prompt ? String(prompt) : "");

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

      const bgPrompt = buildStyleBackgroundPrompt(style);

      // Honor the user's model choice when it can take two images; Flux
      // Kontext is single-image only, so it falls back to Nano Banana Pro.
      const bgPrimary =
        COMPOSE_MODELS.find((m) => m.id === modelId) ??
        getComposeModelConfig("google/nano-banana-pro");
      const bgFallback = getComposeModelConfig(
        bgPrimary.id === "openai/gpt-image-2" ? "google/nano-banana-pro" : "openai/gpt-image-2"
      );

      const runBg = (config: ModelConfig) => {
        const res = resolveResolution(config, resolution);
        return runModel(replicate, config.id, {
          prompt: bgPrompt,
          aspect_ratio: aspectRatio,
          output_format: config.outputFormat,
          ...(res ? { [config.resolutionParam ?? "resolution"]: res } : {}),
          ...config.extraInput,
          ...buildComposeImageInput(config, [imageUrl, uploadedBackground!.urls.get]),
        });
      };

      let outputs: unknown[];
      try {
        outputs = await Promise.all(
          Array.from({ length: numOutputs }, () => runBg(bgPrimary))
        );
      } catch (err) {
        if (!isTransientModelError(err)) throw err;
        console.warn(`${bgPrimary.id} at capacity — falling back to ${bgFallback.id}`);
        outputs = await Promise.all(
          Array.from({ length: numOutputs }, () => runBg(bgFallback))
        );
      }
      const images = await rehostAll(outputs.map(extractImageUrl));
      return NextResponse.json({ images, uploadUrl });
    }

    // Normal single-image flow
    let outputs: unknown[];
    try {
      outputs = await Promise.all(
        Array.from({ length: numOutputs }, () =>
          runOne(promptText, imageUrl, aspectRatio, modelId, resolution)
        )
      );
    } catch (err) {
      if (!isTransientModelError(err)) throw err;
      const fb = fallbackModelId(modelId);
      console.warn(`${modelId} at capacity — falling back to ${fb}`);
      outputs = await Promise.all(
        Array.from({ length: numOutputs }, () =>
          runOne(promptText, imageUrl, aspectRatio, fb, resolution)
        )
      );
    }
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
