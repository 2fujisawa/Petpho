import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";
import { applyMaskAsAlpha } from "@/lib/cutout";
import { rehostBuffer } from "@/lib/storage";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Grounding DINO + SAM, prompt-targeted segmentation. Saliency-based removers
// (RMBG/BiRefNet) treat a bold graphic backdrop — like the orange disc behind
// our Pixar pets — as part of the subject and keep it. Prompting for the animal
// specifically cuts only the pet out and drops the backdrop.
const GROUNDED_SAM =
  "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c";

const MASK_PROMPT = "dog, cat, pet, animal";

// The model returns [annotated, neg_annotated, mask, inverted_mask].
const MASK_INDEX = 2;

export async function POST(req: NextRequest) {
  const { imageUrl } = await req.json();

  if (!imageUrl || typeof imageUrl !== "string") {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }

  try {
    const output = await replicate.run(GROUNDED_SAM, {
      input: {
        image: imageUrl,
        mask_prompt: MASK_PROMPT,
        negative_mask_prompt: "",
      },
    });

    const urls = (Array.isArray(output) ? output : [output]).map(String);
    const maskUrl = urls[MASK_INDEX];
    if (!maskUrl) {
      throw new Error("Couldn't find a pet to cut out in this image");
    }

    const [imgRes, maskRes] = await Promise.all([fetch(imageUrl), fetch(maskUrl)]);
    if (!imgRes.ok || !maskRes.ok) {
      throw new Error("Could not load the image or its mask");
    }

    const cutout = await applyMaskAsAlpha(
      Buffer.from(await imgRes.arrayBuffer()),
      Buffer.from(await maskRes.arrayBuffer())
    );

    // Must stay a PNG — a jpg round-trip would flatten the transparency away.
    const url = await rehostBuffer(cutout, "image/png", "cutouts");
    if (!url) {
      throw new Error("Could not save the cutout");
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("Background removal error:", err);
    const message = err instanceof Error ? err.message : "Background removal failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
