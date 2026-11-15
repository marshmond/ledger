import { useMemo } from 'react';
import { rankAttention, type AttentionRead, type RankedAttention } from '../../core/attention';
import { allAttentionSources } from '../../core/registry';

export interface NeedsYou {
  /** Ranked and de-duplicated (core/attention.ts). Empty until every source has answered once. */
  ranked: RankedAttention[];
  /** False until every source has finished its first read. Nothing is drawn before that, so the list never jumps as modules answer. */
  ready: boolean;
  /** Modules whose read threw. Their items are missing, never replaced by a zero, and the page says so. */
  failed: string[];
}

/**
 * The one data source for "Needs you": every module's `contributes.attention`, read together (each source runs its own live query, so the reads are
 * concurrent and the list updates by itself when a record changes), then ranked by the pure rules in core/attention.ts. The Today section and the full
 * list use this same hook, so they can never disagree. Read only: nothing is written, stored or cached.
 *
 * The registry is fixed at start-up, so the sources (and therefore the hooks below) are the same, in the same order, on every render.
 */
export function useNeedsYou(today: string): NeedsYou {
  const sources = useMemo(() => allAttentionSources(), []);
  const reads: AttentionRead[] = [];
  for (const s of sources) reads.push(s.source.useItems(today));
  const ready = reads.every((r) => r.ready);
  const failed = sources.filter((_, i) => reads[i].failed).map((s) => s.moduleId);
  // Ranking a few dozen items is cheap and pure, so it is simply done on every render.
  const ranked = ready ? rankAttention(reads.flatMap((r) => r.items), today) : [];
  return { ranked, ready, failed };
}
