export const SESSION_COOKIE = "petpho-session";

// The cookie used to hold the admin password verbatim, so anything that could
// read it (a proxy log, a shared machine, a backup) handed over the password
// itself. Store a derived digest instead: it still can't be forged without the
// password, but it isn't the password.
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`petpho-session-v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparison that doesn't leak how far it matched via timing.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
