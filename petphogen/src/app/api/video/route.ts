import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { rehostVideo } from "@/lib/storage";
import { runModel, describeModelError } from "@/lib/replicateRun";
import {
  getVideoModelConfig,
  DEFAULT_VIDEO_MODEL,
  VIDEO_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  MAX_VIDEO_DURATION,
} from "@/lib/models";

// Video generation routinely runs for several minutes — far past the default
// function timeout, which would otherwise kill a clip the user already paid for.
export const maxDuration = 800;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { imageUrl, prompt, model, resolution, aspectRatio, generateAudio } = body;

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { error: "Describe the motion you want — Seedance needs a prompt even with a first frame." },
      { status: 400 }
    );
  }

  const config = getVideoModelConfig(typeof model === "string" ? model : DEFAULT_VIDEO_MODEL);

  // -1 means "let the model choose", so it has to survive clamping — a plain
  // Math.max(1, …) floor would silently turn it into a 1-second clip.
  const rawDuration = Number(body.duration);
  const duration = Number.isFinite(rawDuration)
    ? rawDuration === -1
      ? -1
      : Math.min(Math.max(Math.round(rawDuration), 1), MAX_VIDEO_DURATION)
    : 5;

  // Send only values the model's schema actually lists; anything else is
  // rejected outright rather than falling back to a default.
  const safeResolution = VIDEO_RESOLUTIONS.includes(resolution) ? resolution : "720p";
  const safeAspect = VIDEO_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : "adaptive";

  try {
    const output = await runModel(
      replicate,
      config.id,
      {
        prompt: prompt.trim().slice(0, 4000), // model's documented cap
        duration,
        resolution: safeResolution,
        aspect_ratio: safeAspect,
        generate_audio: generateAudio !== false,
        // A first frame is optional: with one it animates that exact still,
        // without one it's plain text-to-video.
        ...(typeof imageUrl === "string" && imageUrl ? { image: imageUrl } : {}),
      },
      // Each attempt costs minutes, so retry once rather than the usual twice.
      { retries: 1 }
    );

    const videoUrl = Array.isArray(output) ? String(output[0] ?? "") : String(output ?? "");
    if (!videoUrl) {
      throw new Error("The model returned no video — it may have declined the request.");
    }

    return NextResponse.json({ url: await rehostVideo(videoUrl) });
  } catch (err) {
    console.error("Video error:", err);
    return NextResponse.json({ error: describeModelError(err, config.name) }, { status: 500 });
  }
}
