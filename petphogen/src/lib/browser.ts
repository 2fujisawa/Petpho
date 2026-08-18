// Browser-only helpers for the studio. Nothing here may be imported by a route.

// Full-size copy for the Originals library. Only shrinks when the file is big
// enough to risk the upload limit — otherwise the bytes go through untouched.
export async function makeArchiveFile(file: File): Promise<File> {
  const MAX_BYTES = 8 * 1024 * 1024;
  if (file.size <= MAX_BYTES) return file;
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 2560;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file);
        },
        "image/jpeg",
        0.9
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
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
