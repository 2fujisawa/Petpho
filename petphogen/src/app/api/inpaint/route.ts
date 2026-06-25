import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export async function POST(req: NextRequest) {
  const { imageUrl, maskDataUrl, prompt } = await req.json();

  if (!imageUrl || !maskDataUrl || !prompt?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const maskBase64 = (maskDataUrl as string).replace(/^data:image\/\w+;base64,/, "");
  const maskBuffer = Buffer.from(maskBase64, "base64");

  let uploadedImage: Awaited<ReturnType<typeof replicate.files.create>> | null = null;
  let uploadedMask: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Could not fetch source image");
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const imgType = imgRes.headers.get("content-type") || "image/jpeg";

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

    return NextResponse.json({ images: [String(output)] });
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
