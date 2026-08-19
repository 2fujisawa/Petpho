import sharp from "./sharpConfig";

// Grounding DINO sometimes latches onto fragments of neighbouring objects (a
// prop the pet is holding, a shadow blob). Anything far smaller than the main
// subject is noise, so keep only components within `minRatio` of the largest.
function keepMainComponents(bin: Buffer, W: number, H: number, minRatio = 0.05): Buffer {
  const label = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  const sizes: number[] = [];

  for (let start = 0; start < W * H; start++) {
    if (bin[start] < 128 || label[start] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = start;
    label[start] = id;

    // Iterative flood fill — recursion would blow the stack on a 4MP mask.
    while (head < tail) {
      const p = queue[head++];
      count++;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) { const n = p - 1; if (bin[n] >= 128 && label[n] === -1) { label[n] = id; queue[tail++] = n; } }
      if (x < W - 1) { const n = p + 1; if (bin[n] >= 128 && label[n] === -1) { label[n] = id; queue[tail++] = n; } }
      if (y > 0) { const n = p - W; if (bin[n] >= 128 && label[n] === -1) { label[n] = id; queue[tail++] = n; } }
      if (y < H - 1) { const n = p + W; if (bin[n] >= 128 && label[n] === -1) { label[n] = id; queue[tail++] = n; } }
    }
    sizes.push(count);
  }

  const max = sizes.reduce((a, b) => (b > a ? b : a), 0);
  const out = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    out[i] = label[i] >= 0 && sizes[label[i]] >= max * minRatio ? 255 : 0;
  }
  return out;
}

// Turns a soft, JPEG-compressed segmentation mask into a clean alpha channel on
// the source image: binarize, drop specks, feather the edge, attach as alpha.
export async function applyMaskAsAlpha(imageBuffer: Buffer, maskBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width!;
  const H = meta.height!;

  const bin = await sharp(maskBuffer)
    .resize(W, H, { fit: "fill" })
    .greyscale()
    .threshold(128)
    .raw()
    .toBuffer();

  const cleaned = keepMainComponents(bin, W, H);

  // sharp re-expands single-channel raw to 3-channel sRGB, so force it back to
  // greyscale before joining or the alpha lands interleaved and garbled.
  const feathered = await sharp(cleaned, { raw: { width: W, height: H, channels: 1 } })
    .blur(1.2)
    .greyscale()
    .raw()
    .toBuffer();

  const rgb = await sharp(imageBuffer).removeAlpha().raw().toBuffer();

  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(feathered, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
}
