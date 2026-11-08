/**
 * The one check for a link the owner types into a record (a document link, a provider page). ST-S2 (ARCH-02): Home & Assets, Household Services and Bills each had
 * an identical copy; they now all use this one, and each module still exports `isSafeUrl` under the same name so no caller changed.
 *
 * ONLY absolute `http:` and `https:` addresses pass. Everything else is refused: `javascript:`, `data:`, `file:`, `blob:`, `vbscript:`, `ftp:`, `mailto:`, a relative path
 * (`/x`, `../x`), a bare word, an empty string and anything the browser cannot parse. Scheme case does not matter (`HTTPS://` is fine, `JavaScript:` is not). Leading and
 * trailing spaces are tolerated exactly as before (the URL parser ignores them), so a link that was valid when saved is still valid; nothing is rewritten here.
 * This is a safety check, not proof the page is trustworthy or exists.
 */
export function isSafeUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}
