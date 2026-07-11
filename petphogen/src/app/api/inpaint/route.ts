import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import sharp from "sharp";
import { rehostAll } from "@/lib/storage";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export async function POST(req: NextRequest) {
  const { imageUrl, maskDataUrl, prompt, aspectRatio } = await req.json();

  if (!imageUrl || !maskDataUrl || !prompt?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const maskBase64 = (maskDataUrl as string).replace(/^data:image\/\w+;base64,/, "");
  let maskBuffer = Buffer.from(maskBase64, "base64");

  let uploadedImage: Awaited<ReturnType<typeof replicate.files.create>> | null = null;
  let uploadedMask: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Could not fetch source image");
    let imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    let imgType = imgRes.headers.get("content-type") || "image/jpeg";

    // Outpaint to a new aspect ratio: extend the canvas (image + mask) and let
    // the model fill the new regions. The mask's extended area is white = regenerate.
    if (typeof aspectRatio === "string" && /^\d+:\d+$/.test(aspectRatio)) {
      const meta = await sharp(imgBuffer).metadata();
      const w = meta.width!;
      const h = meta.height!;
      const [arW, arH] = aspectRatio.split(":").map(Number);
      const targetRatio = arW / arH;
      const curRatio = w / h;
      let padL = 0, padR = 0, padT = 0, padB = 0;
      if (targetRatio > curRatio + 0.001) {
        const newW = Math.round(h * targetRatio);
        padL = Math.floor((newW - w) / 2);
        padR = newW - w - padL;
      } else if (targetRatio < curRatio - 0.001) {
        const newH = Math.round(w / targetRatio);
        padT = Math.floor((newH - h) / 2);
        padB = newH - h - padT;
      }
      if (padL || padR || padT || padB) {
        const white = { r: 255, g: 255, b: 255, alpha: 1 };
        [imgBuffer, maskBuffer] = await Promise.all([
          sharp(imgBuffer).extend({ top: padT, bottom: padB, left: padL, right: padR, background: white }).jpeg({ quality: 95 }).toBuffer(),
          sharp(maskBuffer).extend({ top: padT, bottom: padB, left: padL, right: padR, background: white }).png().toBuffer(),
        ]);
        imgType = "image/jpeg";
      }
    }

    [uploadedImage, uploadedMask] = await Promise.all([
      replicate.files.create(new Blob([imgBuffer], { type: imgType })),
      replicate.files.create(new Blob([maskBuffer], { type: "image/png" })),
    ]);

    const output = await replicate.run("black-forest-labs/flux-fill-pro", {
      input: {
        image: uploadedImage.urls.get,
        mask: uploadedMask.urls.get,
        prompt: `Disney Pixar 3D animated style, ${(prompt as string).trim()}, big expressive eyes, smooth 3D render, cinematic lighting, vibrant colors, Pixar movie quality`,
        output_format: "jpg",
      },
    });

    const images = await rehostAll([String(output)]);
    return NextResponse.json({ images });
  } catch (err) {
    console.error("Inpaint error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inpainting failed" },
      { status: 500 }
    );
  } finally {
    await Promise.all([
      uploadedImage && replicate.files.delete(uploadedImage.id).catch(() => {}),
      uploadedMask && replicate.files.delete(uploadedMask.id).catch(() => {}),
    ]);
  }
}
