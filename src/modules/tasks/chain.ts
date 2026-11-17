/**
 * The repeat chain of a Task. PURE.
 *
 * Completing a repeating Task creates its successor with `recurFrom` set to the task it came from, so a chain is "t1 <- t2 <- t3". The ROOT is the
 * first one. Anything that needs to say "this whole repeating series" (the family-display approval is one) keys on the root, so finishing a
 * repeat does not lose the choice and never makes a private series public.
 *
 * Ambiguity is reported, not guessed: a missing ancestor (not even a deletion marker), a loop, or a chain longer than the limit has NO root (`null`).
 * A soft-deleted ancestor still counts: the record is there, so the chain is intact.
 */
export const MAX_CHAIN = 500;

export interface ChainNode { id: number; recurFrom?: number }

export function taskRootId(id: number, byId: ReadonlyMap<number, ChainNode>): number | null {
  const seen = new Set<number>();
  let cur = byId.get(id);
  if (!cur) return null;
  while (true) {
    if (seen.has(cur.id) || seen.size >= MAX_CHAIN) return null;
    seen.add(cur.id);
    if (cur.recurFrom === undefined) return cur.id;
    const next = byId.get(cur.recurFrom);
    if (!next) return null;
    cur = next;
  }
}
