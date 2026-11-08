/**
 * Payee comparison for Bills B3.1 (match suggestions, recurring-expense discovery, Finance Scheduled links). PURE.
 *
 * It uses Finance's own `normPayee` (lowercase, no punctuation, no store numbers), then compares WORDS, never characters, and it refuses to be
 * impressed by words every provider shares. Two payees match only when they share a SIGNIFICANT word: not a filler word ("co", "inc", "bill",
 * "pay") and not an industry word ("power", "water", "insurance", "premium"). So "Example Power Co" and "Another Power Co" are NOT alike,
 * "Streamly" and "STREAMLY PREMIUM 8841" are, and a short generic bill name such as "Rent" never matches anything on its own.
 *
 * A word the owner approved as a payee hint is trusted as written (it may be an industry word on purpose).
 *
 * Results:  exact    one whole name sits inside the other and they share a significant word
 *           partial  they share a significant word but neither contains the other (a weak resemblance; never enough alone)
 *           none
 */
import { normPayee } from '../../lib/financeRead';

export type PayeeVia = 'hint' | 'provider' | 'title' | 'rule';
export interface PayeeName { text: string; via: PayeeVia }
export type PayeeKind = 'exact' | 'partial' | 'none';
export interface PayeeMatch { kind: PayeeKind; via: PayeeVia | null; word: string | null }

/** Words that say nothing about WHO the payee is. */
const STOP = new Set(['co', 'inc', 'llc', 'ltd', 'corp', 'company', 'the', 'and', 'of', 'for', 'payment', 'payments', 'pay', 'bill', 'bills', 'online', 'web', 'www', 'com', 'net', 'org', 'usa', 'autopay', 'recurring', 'purchase', 'debit', 'card', 'ach', 'pos']);
/** Industry and plan words many different providers share. */
const GENERIC = new Set(['power', 'electric', 'electricity', 'energy', 'water', 'gas', 'sewer', 'trash', 'waste', 'utility', 'utilities', 'insurance', 'internet', 'broadband', 'cable', 'phone', 'mobile', 'wireless', 'premium', 'plus', 'basic', 'standard', 'pro', 'monthly', 'annual', 'yearly', 'subscription', 'membership', 'service', 'services', 'rent', 'loan', 'mortgage', 'tax', 'taxes', 'music', 'video', 'streaming', 'cloud', 'news', 'home', 'auto', 'life', 'health', 'dental', 'club', 'fitness', 'gym', 'storage', 'security']);

const toks = (s: string) => normPayee(s).split(' ').filter(Boolean);
const significant = (s: string) => toks(s).filter((w) => w.length >= 3 && !STOP.has(w) && !GENERIC.has(w));
const trusted = (s: string) => toks(s).filter((w) => w.length >= 2 && !STOP.has(w));

function phraseIn(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

const VIA_RANK: Record<PayeeVia, number> = { hint: 0, rule: 1, provider: 2, title: 3 };
const NONE: PayeeMatch = { kind: 'none', via: null, word: null };

/** How alike a payee is to any of the given names. The best result wins (exact before partial, then hint, rule, provider, title). */
export function payeeMatch(payee: string, names: PayeeName[]): PayeeMatch {
  const hay = toks(payee);
  if (hay.length === 0) return NONE;
  let best: PayeeMatch = NONE;
  const better = (a: PayeeMatch, b: PayeeMatch) => (a.kind === b.kind ? (a.via ? VIA_RANK[a.via] : 9) < (b.via ? VIA_RANK[b.via] : 9) : a.kind === 'exact');
  for (const n of names) {
    const nt = toks(n.text);
    if (nt.length === 0) continue;
    const words = n.via === 'hint' ? trusted : significant;
    const mine = words(payee), theirs = words(n.text);
    const shared = mine.filter((w) => theirs.includes(w));
    if (shared.length === 0) continue;
    const m: PayeeMatch = phraseIn(hay, nt) || phraseIn(nt, hay) ? { kind: 'exact', via: n.via, word: shared[0] } : { kind: 'partial', via: n.via, word: shared[0] };
    if (best.kind === 'none' || better(m, best)) best = m;
  }
  return best;
}

/** The names a bill can be recognised by: the payee words the owner approved, the provider's name and the bill's own title. */
export function namesOfBill(d: { payeeHints: string[]; providerNameSnapshot: string; title: string }): PayeeName[] {
  return [
    ...d.payeeHints.filter((h) => h.trim()).map((text) => ({ text, via: 'hint' as const })),
    ...(d.providerNameSnapshot.trim() ? [{ text: d.providerNameSnapshot, via: 'provider' as const }] : []),
    ...(d.title.trim() ? [{ text: d.title, via: 'title' as const }] : []),
  ];
}

/** The text stored as an approved payee word: Finance's normalised form, bounded. Empty when nothing usable is left. */
export const hintOf = (payee: string): string => normPayee(payee).slice(0, 60).trim();

/** Words in the payee a person would recognise, for a plain explanation (never used for matching). */
export const significantWords = significant;
