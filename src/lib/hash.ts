/** SHA-256 hex digest via the browser's built-in Web Crypto API -- no extra dependency needed.
 * Used for the admin PIN so it isn't sitting in plain text in local storage/IndexedDB. Note:
 * for a short numeric PIN this raises the bar from "readable at a glance" to "would need to be
 * brute-forced" -- it does not make a 4-digit PIN cryptographically strong on its own (the
 * search space is tiny either way), but it's a real, cheap improvement over storing it as-is. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
