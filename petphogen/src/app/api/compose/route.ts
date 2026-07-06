import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { rehostAll } from "@/lib/storage";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sourceImageUrl = formData.get("sourceImageUrl") as string;
  const backgroundPhoto = formData.get("backgroundPhoto");

  if (!sourceImageUrl || !(backgroundPhoto instanceof Blob) || backgroundPhoto.size === 0) {
    return NextResponse.json({ error: "Missing source image or background photo" }, { status: 400 });
  }

  let uploadedBackground: Awaited<ReturnType<typeof replicate.files.create>> | null = null;

  try {
    const bgBuffer = Buffer.from(await backgroundPhoto.arrayBuffer());
    uploadedBackground = await replicate.files.create(
      new Blob([bgBuffer], { type: backgroundPhoto.type || "image/jpeg" })
    );

    const prompt = `Take the Pixar 3D animated character from the first image and place it naturally inside the scene shown in the second image. Keep the character's appearance exactly the same — same colors, features, expression, and Pixar animation style. Keep the background scene exactly as shown in the second image — same furniture, lighting, colors, and layout. Match the character's lighting and shadows to the scene. The result should look like a single cohesive Pixar movie still. Cinematic quality.`;

    const output = await replicate.run("google/nano-banana" as `${string}/${string}`, {
      input: {
        image_input: [sourceImageUrl, uploadedBackground.urls.get],
        prompt,
        output_format: "jpg",
      },
    });

    const images = await rehostAll([String(output)]);
    return NextResponse.json({ images });
  } catch (err) {
    console.error("Compose error:", err);
    const message = err instanceof Error ? err.message : "Compose failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (uploadedBackground) {
      await replicate.files.delete(uploadedBackground.id).catch(() => {});
    }
  }
}
