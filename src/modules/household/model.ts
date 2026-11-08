/**
 * Household finances (B5): the shared words and small helpers of the consolidated view. PURE.
 *
 * Three FINANCIAL IDEAS that this layer keeps apart and never adds together (B0 12.2, B5 prompt part II):
 *   - COMMITMENTS      what the household has agreed or reasonably expects to owe under known arrangements (a schedule, a contract, a price). Not evidence of payment.
 *   - EXPECTED PAYMENTS what is anticipated inside a chosen future window (7, 30 or 90 days), with its timing. Not a transaction.
 *   - RECORDED SPENDING what is backed by a confirmed reference to a Finance transaction (or one valid part of it) or by an explicit outside-Finance amount an owner typed.
 * A payment recorded once in Finance is ONE payment however many household records point at it.
 */

/** The three claimants of recorded money. */
export type HMod = 'bills' | 'services' | 'home';
/** Fixed order: the order modules are listed in, never an order that decides a total. */
export const HMOD_ORDER: readonly HMod[] = ['bills', 'services', 'home'];
export const HMOD_LABEL: Record<HMod, string> = { bills: 'Bills & Subscriptions', services: 'Household Services', home: 'Home & Assets' };
/** Where a counted amount is credited in the ADDITIVE breakdown: one module, or "shared" when more than one module reaches it. */
export type Attribution = HMod | 'shared';
export const ATTRIBUTION_ORDER: readonly Attribution[] = ['bills', 'services', 'home', 'shared'];
export const ATTRIBUTION_LABEL: Record<Attribution, string> = { ...HMOD_LABEL, shared: 'Shared between modules' };

/** Which module a cost-record id belongs to (the ids the three readers already use). */
export function moduleOfRecord(recordId: string): HMod {
  if (recordId.startsWith('bill:')) return 'bills';
  if (recordId.startsWith('visit:') || recordId.startsWith('arrangement:')) return 'services';
  return 'home';
}

/** A hash address for the record behind a cost record (the module prefix is part of the address). Ids only, never a name or an amount. */
export function hrefOfRecord(recordId: string, assetId?: number): string {
  const [kind, a, b] = recordId.split(':');
  if (kind === 'bill') return `#/bills/o/${a}`;
  if (kind === 'visit') return `#/services/v/${a}`;
  if (kind === 'arrangement') return `#/services/a/${a}`;
  if (kind === 'service') return assetId !== undefined ? `#/assets/${assetId}?service=${a}` : '#/assets';
  if (kind === 'asset') return `#/assets/${a}`;
  void b;
  return '#/household';
}

export const HOUSEHOLD_BASE = '/household';
export const householdPath = () => '/household';

/** How sure a figure is. Used for every expected amount; an unknown or disputed amount is NEVER added as zero. */
export type Certainty = 'known' | 'estimated' | 'unknown' | 'disputed';
export const CERTAINTY_LABEL: Record<Certainty, string> = { known: 'Known', estimated: 'Estimated', unknown: 'Not known', disputed: 'In dispute' };

/** The five kinds of thing the Needs review list can say (B5 part VIII). They are never mixed: sharing is not a duplicate. */
export type ReviewClass = 'informational' | 'possible-duplicate' | 'confirmed-duplicate' | 'missing-evidence' | 'contractual-overlap' | 'lifecycle';
export const REVIEW_CLASS_LABEL: Record<ReviewClass, string> = {
  informational: 'Good to know (nothing is wrong)',
  'possible-duplicate': 'Possible duplicate',
  'confirmed-duplicate': 'Linked as one payment (already handled)',
  'missing-evidence': 'Missing or out-of-date evidence',
  'contractual-overlap': 'Two records may describe one expense',
  lifecycle: 'Subscription dates and cancellations',
};
