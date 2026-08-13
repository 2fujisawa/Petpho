import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { rehostVideo } from "@/lib/storage";
import { describeModelError } from "@/lib/replicateRun";
import {
  getVideoModelConfig,
  DEFAULT_VIDEO_MODEL,
  VIDEO_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  MAX_VIDEO_DURATION,
} from "@/lib/models";

// Both handlers return in seconds. The generation itself is NOT awaited here —
// see the note on POST — so this only has to cover starting a prediction, or
// fetching a finished clip and copying it into Blob.
export const maxDuration = 300;

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Start a prediction and hand the id straight back.
//
// Holding the request open for the whole render is not viable: a real clip took
// 100s at the *cheapest* settings (fast model, 480p, 5s), and 1080p/15s on the
// full model runs several times that — past the 300s ceiling this plan allows,
// which would kill a video the user already paid for. Polling via GET below
// makes the wait independent of any function timeout.
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
    const prediction = await replicate.predictions.create({
      model: config.id,
      input: {
        prompt: prompt.trim().slice(0, 4000), // model's documented cap
        duration,
        resolution: safeResolution,
        aspect_ratio: safeAspect,
        generate_audio: generateAudio !== false,
        // A first frame is optional: with one it animates that exact still,
        // without one it's plain text-to-video.
        ...(typeof imageUrl === "string" && imageUrl ? { image: imageUrl } : {}),
      },
    });

    return NextResponse.json({ id: prediction.id, status: prediction.status });
  } catch (err) {
    console.error("Video start error:", err);
    return NextResponse.json({ error: describeModelError(err, config.name) }, { status: 500 });
  }
}

// Poll a running prediction. On success the clip is copied into Blob before the
// URL is handed back, because Replicate's own output URLs expire — storing one
// in history is what produces a permanently broken "Expired" card later.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "No prediction id" }, { status: 400 });
  }

  try {
    const prediction = await replicate.predictions.get(id);

    if (prediction.status === "succeeded") {
      const out = prediction.output;
      const videoUrl = Array.isArray(out) ? String(out[0] ?? "") : String(out ?? "");
      if (!videoUrl) {
        return NextResponse.json(
          { status: "failed", error: "The model returned no video — it may have declined the request." },
          { status: 500 }
        );
      }

      const { url, archived } = await rehostVideo(videoUrl);
      return NextResponse.json({ status: "succeeded", url, archived });
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      const raw = prediction.error ? String(prediction.error) : "Video generation failed";
      return NextResponse.json(
        { status: "failed", error: describeModelError(new Error(raw), "This video model") },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: prediction.status });
  } catch (err) {
    console.error("Video poll error:", err);
    return NextResponse.json(
      { status: "failed", error: err instanceof Error ? err.message : "Could not check the video" },
      { status: 500 }
    );
  }
}
