import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import sharp from "@/lib/sharpConfig";
import { rehostAll, rehostGeneratedBuffer } from "@/lib/storage";
import { runModel, describeModelError } from "@/lib/replicateRun";
import {
  getEditModelConfig,
  buildComposeImageInput,
  extractImageUrl,
  resolveComposeAspectRatio,
  resolveResolution,
  DEFAULT_EDIT_MODEL,
} from "@/lib/models";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Flux Fill Pro has no resolution input — output size always matches the
// input image. To offer a resolution choice anyway, upscale the result
// afterward to the chosen long-edge pixel size.
const RESOLUTION_PX: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { imageUrl, maskDataUrl, prompt, aspectRatio, photoX, photoY, photoScale, model } = body;
  // Reassigned below when the model renders at the target resolution natively,
  // so the post-hoc upscale is skipped.
  let resolution: string | undefined =
    typeof body.resolution === "string" ? body.resolution : undefined;

  if (!imageUrl || !maskDataUrl || !prompt?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const config = getEditModelConfig(typeof model === "string" ? model : DEFAULT_EDIT_MODEL);

  // Where the photo sits in the expanded canvas. Defaults reproduce the old
  // behaviour exactly: centred, as large as it can be without cropping.
  const placeX = clamp(Number.isFinite(photoX) ? photoX : 50, 0, 100);
  const placeY = clamp(Number.isFinite(photoY) ? photoY : 50, 0, 100);
  const placeScale = clamp(Number.isFinite(photoScale) ? photoScale : 100, 20, 100);

  const maskBase64 = (maskDataUrl as string).replace(/^data:image\/\w+;base64,/, "");
  const rawMaskBuffer = Buffer.from(maskBase64, "base64");
  // Mask covering the brushed region only (black elsewhere = leave alone).
  let maskBuffer = rawMaskBuffer;
  // Mask covering only the newly-added canvas area, with the photo itself
  // blacked out so the extension pass can't touch it.
  let outpaintMaskBuffer: Buffer | null = null;

  // Every temp upload we make, so the finally block can clean all of them up.
  const uploads: Awaited<ReturnType<typeof replicate.files.create>>[] = [];
  const upload = async (buf: Buffer, type: string) => {
    const file = await replicate.files.create(new Blob([new Uint8Array(buf)], { type }));
    uploads.push(file);
    return file.urls.get;
  };

  try {
    // Did the user actually paint anything? An all-black mask means they only
    // wanted the canvas extended, and running an "edit" pass on it would just
    // burn a model call for no change.
    const brushStats = await sharp(rawMaskBuffer).greyscale().stats();
    const hasBrush = brushStats.channels[0].max > 8;

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Could not fetch source image");
    let imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    let imgType = imgRes.headers.get("content-type") || "image/jpeg";

    // Outpaint to a new aspect ratio: build a larger canvas and drop the photo
    // onto it at the requested spot and size, so the model can fill around it.
    //
    // Two *separate* masks come out of this, and keeping them apart matters:
    // merging them into one would hand the extension area to the user's edit
    // prompt, and the model would paint that edit right across the new border.
    //
    // The canvas is sized so that scale=100 has the photo at its native
    // resolution spanning whichever axis constrains it — so the default,
    // centred case comes out pixel-identical to a plain centred extend.
    if (typeof aspectRatio === "string" && /^\d+:\d+$/.test(aspectRatio)) {
      const meta = await sharp(imgBuffer).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const [arW, arH] = aspectRatio.split(":").map(Number);
      const targetRatio = arW / arH;
      const curRatio = w / h;

      const canvasW = targetRatio > curRatio ? Math.round(h * targetRatio) : w;
      const canvasH = targetRatio > curRatio ? h : Math.round(w / targetRatio);

      const photoW = Math.max(1, Math.round(w * (placeScale / 100)));
      const photoH = Math.max(1, Math.round(h * (placeScale / 100)));

      const left = clamp(
        Math.round((canvasW * placeX) / 100 - photoW / 2),
        0,
        Math.max(0, canvasW - photoW)
      );
      const top = clamp(
        Math.round((canvasH * placeY) / 100 - photoH / 2),
        0,
        Math.max(0, canvasH - photoH)
      );

      const needsCanvas =
        canvasW !== w || canvasH !== h || photoW !== w || photoH !== h;

      if (needsCanvas) {
        const white = { r: 255, g: 255, b: 255 };
        const black = { r: 0, g: 0, b: 0 };
        const [photoResized, maskResized, photoBlock] = await Promise.all([
          sharp(imgBuffer).resize(photoW, photoH).toBuffer(),
          sharp(rawMaskBuffer).resize(photoW, photoH).toBuffer(),
          sharp({ create: { width: photoW, height: photoH, channels: 3, background: black } })
            .png()
            .toBuffer(),
        ]);
        [imgBuffer, maskBuffer, outpaintMaskBuffer] = await Promise.all([
          sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: white } })
            .composite([{ input: photoResized, left, top }])
            .jpeg({ quality: 95 })
            .toBuffer(),
          // Edit mask: black canvas, brush strokes only where the photo sits.
          sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: black } })
            .composite([{ input: maskResized, left, top }])
            .png()
            .toBuffer(),
          // Extension mask: white everywhere new, photo rect blacked out.
          sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: white } })
            .composite([{ input: photoBlock, left, top }])
            .png()
            .toBuffer(),
        ]);
        imgType = "image/jpeg";
      }
    }

    const styleSuffix =
      "big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, Pixar movie quality";
    const userPrompt = (prompt as string).trim();
    let output: unknown;

    if (config.usesMask) {
      if (!outpaintMaskBuffer && !hasBrush) {
        return NextResponse.json(
          { error: "Brush over the part of the photo you want to change first." },
          { status: 400 }
        );
      }

      // Pass 1 — grow the canvas. This gets its own prompt describing a plain
      // scene continuation; handing it the user's edit text is what used to
      // smear that edit across the whole new border.
      if (outpaintMaskBuffer) {
        const extended = await runModel(replicate, config.id, {
          image: await upload(imgBuffer, imgType),
          mask: await upload(outpaintMaskBuffer, "image/png"),
          prompt:
            "Seamlessly extend and continue the existing background scene outward to fill the " +
            "empty area, matching its colours, lighting, textures and perspective exactly. " +
            "Pure background continuation only — do not add any new subject, object, character, " +
            "text, pattern, frame or decoration. " +
            `Disney Pixar 3D animated style, ${styleSuffix}.`,
          output_format: config.outputFormat,
        });
        const extRes = await fetch(extractImageUrl(extended));
        if (!extRes.ok) throw new Error("Could not read the extended canvas");
        imgBuffer = Buffer.from(await extRes.arrayBuffer());
        imgType = "image/jpeg";
        output = extended;

        // The model can return slightly different dimensions; realign the edit
        // mask to whatever actually came back before using it.
        if (hasBrush) {
          const extMeta = await sharp(imgBuffer).metadata();
          maskBuffer = await sharp(maskBuffer)
            .resize(extMeta.width!, extMeta.height!, { fit: "fill" })
            .png()
            .toBuffer();
        }
      }

      // Pass 2 — the actual brushed edit, confined to the strokes.
      if (hasBrush) {
        output = await runModel(replicate, config.id, {
          image: await upload(imgBuffer, imgType),
          mask: await upload(maskBuffer, "image/png"),
          prompt: `Disney Pixar 3D animated style, ${userPrompt}, ${styleSuffix}`,
          output_format: config.outputFormat,
        });
      }
    } else {
      // No mask input on these models. Tint the brushed region onto the photo
      // itself and tell the model to confine the edit there — a hint it can
      // follow, not a hard boundary the sampler enforces.
      const meta = await sharp(imgBuffer).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const tintAlpha = await sharp(maskBuffer)
        .resize(w, h, { fit: "fill" })
        .greyscale()
        .linear(0.55, 0) // partial opacity so the underlying photo stays readable
        .toBuffer();
      const tintLayer = await sharp({
        create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 255 } },
      })
        .png()
        .joinChannel(tintAlpha)
        .toBuffer();
      const markedBuffer = await sharp(imgBuffer)
        .composite([{ input: tintLayer }])
        .jpeg({ quality: 92 })
        .toBuffer();

      // Exactly one image goes in. Passing the plain photo *and* the marked
      // copy makes these models treat the second as something to insert into
      // the first, and they render it picture-in-picture with an invented
      // border. One self-describing image avoids that entirely — and when
      // nothing was brushed the mask is all black, so the tint is invisible
      // and this is simply the original photo.
      const markedUrl = await upload(markedBuffer, "image/jpeg");

      const aspect = resolveComposeAspectRatio(config, aspectRatio, w, h);
      const nativeRes = resolveResolution(config, resolution);

      // Describe only what actually applies. Telling the model to keep the
      // framing while the canvas is deliberately padded with white would leave
      // the blank bands sitting there unfilled.
      const editClause = hasBrush
        ? `${userPrompt}. A translucent magenta tint marks the area to change: apply the edit there ` +
          `and leave everything outside it as it is. The tint is only a marker — remove it completely ` +
          `so no magenta remains in the result. `
        : `${userPrompt}. `;
      const framingClause = outpaintMaskBuffer
        ? `The photo sits on a larger canvas with blank white margins: fill those margins by seamlessly ` +
          `continuing the existing background outward — matching its colours, lighting and perspective — ` +
          `without adding any new subject, text or decoration, and without shrinking or moving the photo. `
        : `Return the edited photo at the same framing and dimensions: do not add any border, frame, ` +
          `matte or extra scenery around it, and do not place the photo inside another image. `;

      output = await runModel(replicate, config.id, {
        prompt:
          `Edit this photo in place. ${editClause}${framingClause}` +
          `Match the existing Disney Pixar 3D animated style: ${styleSuffix}.`,
        output_format: config.outputFormat,
        ...(aspect ? { aspect_ratio: aspect } : {}),
        ...(nativeRes ? { resolution: nativeRes } : {}),
        ...config.extraInput,
        ...buildComposeImageInput(config, [markedUrl]),
      });
      // The model already rendered at the requested resolution — don't upscale again.
      if (nativeRes) resolution = undefined;
    }

    let images: string[] | null = null;
    const targetPx = typeof resolution === "string" ? RESOLUTION_PX[resolution] : undefined;
    if (targetPx) {
      try {
        const outRes = await fetch(extractImageUrl(output));
        if (outRes.ok) {
          const outBuffer = Buffer.from(await outRes.arrayBuffer());
          const meta = await sharp(outBuffer).metadata();
          const landscape = (meta.width ?? 1) >= (meta.height ?? 1);
          const resized = await sharp(outBuffer)
            .resize(landscape ? { width: targetPx } : { height: targetPx })
            .jpeg({ quality: 95 })
            .toBuffer();
          const upscaledUrl = await rehostGeneratedBuffer(resized, "image/jpeg");
          if (upscaledUrl) images = [upscaledUrl];
        }
      } catch (err) {
        console.error("Inpaint upscale error:", err);
      }
    }
    if (!images) images = await rehostAll([extractImageUrl(output)]);

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Inpaint error:", err);
    return NextResponse.json({ error: describeModelError(err, config.name) }, { status: 500 });
  } finally {
    await Promise.all(
      uploads.map((f) => replicate.files.delete(f.id).catch(() => {}))
    );
  }
}
