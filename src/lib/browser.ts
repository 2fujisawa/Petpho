// Browser-only helpers for the studio. Nothing here may be imported by a route.

// Full-size copy for the Originals library.
//
// The platform rejects request bodies past ~4.5MB before the route ever runs
// (same limit CutoutRefiner encodes against), and this file is uploaded
// alongside the compressed model input — so the budget below leaves room for
// that plus form overhead. A modern phone photo is routinely 4-8MB, which
// used to sail past the old 8MB threshold untouched and get the whole
// generation rejected with a generic network failure.
const ARCHIVE_MAX_BYTES = 3.5 * 1024 * 1024;

// Descending size/quality steps, tried in order until one fits.
const ARCHIVE_STEPS: [maxEdge: number, quality: number][] = [
  [2560, 0.9],
  [2048, 0.85],
  [1600, 0.8],
  [1280, 0.75],
];

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    const done = (value: HTMLImageElement | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

function encode(img: HTMLImageElement, maxEdge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function makeArchiveFile(file: File): Promise<File> {
  if (file.size <= ARCHIVE_MAX_BYTES) return file;

  const img = await loadImage(file);
  if (!img) return file; // undecodable — let the server reject it and say why

  let smallest: Blob | null = null;
  for (const [maxEdge, quality] of ARCHIVE_STEPS) {
    const blob = await encode(img, maxEdge, quality);
    if (!blob) continue;
    if (blob.size <= ARCHIVE_MAX_BYTES) {
      return new File([blob], file.name, { type: "image/jpeg" });
    }
    smallest = blob;
  }
  // Still over budget at the smallest step: send the best we managed rather
  // than the original, which definitely wouldn't fit.
  return smallest ? new File([smallest], file.name, { type: "image/jpeg" }) : file;
}

// A plain `<a download>` is ignored by browsers for cross-origin URLs (Blob
// storage / Replicate are both cross-origin from this app) — they just
// navigate to the image instead of downloading it. Fetching the bytes and
// saving via a same-origin blob: URL makes the download attribute honored.
export async function downloadImage(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = url.split("/").pop()?.split("?")[0] || "petpho.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

export function formatDate(ts?: number) {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
