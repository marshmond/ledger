/**
 * Test helper (no browser needed): reads the HTML that React writes out (`renderToStaticMarkup`) and answers the questions an assistive
 * technology asks: what is this control called, which landmarks and headings are there, which message belongs to which field.
 * It follows the same order browsers use for an accessible name: aria-labelledby, aria-label, an associated <label> (for= or wrapping), then title.
 * A placeholder is NOT a name. This is deliberately small; it is not a full accessibility engine.
 */
export interface El { tag: string; attrs: Record<string, string>; children: Array<El | string>; parent: El | null }

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source', 'wbr']);
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) { // closing tag
      let up: El | null = cur;
      while (up && up.tag !== m[1].toLowerCase()) up = up.parent;
      if (up && up.parent) cur = up.parent;
    } else if (m[2]) { // opening tag
      const tag = m[2].toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const el: El = { tag, attrs, children: [], parent: cur };
      cur.children.push(el);
      if (!VOID.has(tag) && !m[4]) cur = el;
    } else if (m[5] !== undefined) {
      cur.children.push(decode(m[5]));
    }
  }
  return root;
}

export function all(root: El, pred: (e: El) => boolean = () => true): El[] {
  const out: El[] = [];
  const walk = (e: El) => { for (const c of e.children) if (typeof c !== 'string') { if (pred(c)) out.push(c); walk(c); } };
  walk(root);
  return out;
}
export const byTag = (root: El, ...tags: string[]) => all(root, (e) => tags.includes(e.tag));
export const byId = (root: El, id: string) => all(root, (e) => e.attrs.id === id)[0] ?? null;

/** The text a person would read in this element (hidden-by-aria content is skipped). */
export function textOf(e: El | string, skip?: El): string {
  if (typeof e === 'string') return e;
  if (e.attrs['aria-hidden'] === 'true' || e === skip) return '';
  return e.children.map((c) => textOf(c, skip)).join('');
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function accessibleName(root: El, el: El): string {
  const by = el.attrs['aria-labelledby'];
  if (by) {
    const t = squash(by.split(/\s+/).map((id) => { const t = byId(root, id); return t ? textOf(t) : ''; }).join(' '));
    if (t) return t;
  }
  const al = squash(el.attrs['aria-label'] ?? '');
  if (al) return al;
  if (el.attrs.id) {
    const lab = all(root, (e) => e.tag === 'label' && e.attrs.for === el.attrs.id)[0];
    if (lab) { const t = squash(textOf(lab, el)); if (t) return t; }
  }
  for (let p = el.parent; p; p = p.parent) if (p.tag === 'label') { const t = squash(textOf(p, el)); if (t) return t; }
  // Buttons, links and summaries are named by their own content.
  if (['button', 'a', 'summary'].includes(el.tag)) { const t = squash(textOf(el)); if (t) return t; }
  return squash(el.attrs.title ?? '');
}

/** Form fields a person can type into or choose from (not hidden, not buttons). */
export const fields = (root: El) => all(root, (e) => (e.tag === 'input' && !['hidden', 'button', 'submit', 'reset'].includes(e.attrs.type ?? 'text')) || e.tag === 'select' || e.tag === 'textarea');

export const unnamedFields = (root: El) => fields(root).filter((f) => !accessibleName(root, f));
export const unnamedButtons = (root: El) => all(root, (e) => e.tag === 'button' || (e.tag === 'a' && 'href' in e.attrs)).filter((b) => !accessibleName(root, b));

export function headings(root: El): { level: number; text: string }[] {
  return all(root, (e) => /^h[1-6]$/.test(e.tag)).map((h) => ({ level: Number(h.tag[1]), text: squash(textOf(h)) }));
}
/** Places where a heading is more than one level deeper than the one before it. */
export function headingSkips(root: El): string[] {
  const hs = headings(root);
  const out: string[] = [];
  for (let i = 1; i < hs.length; i++) if (hs[i].level - hs[i - 1].level > 1) out.push(`h${hs[i - 1].level} "${hs[i - 1].text}" to h${hs[i].level} "${hs[i].text}"`);
  return out;
}

/** The element that a field's aria-describedby points at, and its text. */
export function describedBy(root: El, field: El): { id: string; text: string; role?: string }[] {
  return (field.attrs['aria-describedby'] ?? '').split(/\s+/).filter(Boolean).map((id) => {
    const t = byId(root, id);
    return { id, text: t ? squash(textOf(t)) : '', role: t?.attrs.role };
  });
}
