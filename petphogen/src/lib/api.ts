// Client-side wrappers for the app's own API routes.

// Fire-and-forget delete of a Blob-hosted file. Failures are swallowed on
// purpose: the UI has already dropped the item, and a stray blob is cheaper
// than a broken gallery.
export async function deleteBlob(url: string): Promise<void> {
  try {
    await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {}
}
