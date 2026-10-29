/**
 * The owner's chosen order for category groups, categories and budget targets. Each record may carry an `order` number.
 * Records without one (new, or from before this existed) come after the ordered ones, oldest first.
 */

interface Orderable {
  id?: number;
  order?: number;
}

export function sortByOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

/** `ids` with `moving` taken out and put just before `before` (or last when `before` is null or not in the list). */
export function moveBefore(ids: number[], moving: number, before: number | null): number[] {
  const rest = ids.filter((i) => i !== moving);
  const at = before === null ? -1 : rest.indexOf(before);
  if (at < 0) return [...rest, moving];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** `ids` with `moving` shifted one place up (-1) or down (1); unchanged at the ends. */
export function nudge(ids: number[], moving: number, step: -1 | 1): number[] {
  const i = ids.indexOf(moving);
  const j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
