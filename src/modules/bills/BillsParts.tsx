import { formatCents } from '../../lib/money';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../../core/hideAmounts';
import { dayLabel } from '../../core/time';
import { NEED_LABEL, STATUS_LABEL, TYPE_LABEL, type ExpectedAmount, type ObligationData } from './model';
import { currentAmount } from './views';
import { StatusChip as Chip } from '../../ui/StatusChip';
import { STATUS_TONE } from './presentation';

export const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });

/** Hide Amounts (the global preference) shows no digits anywhere on a Bills page. */
export const useMoney = () => { const hide = loadHideAmounts(); return { hide, money: (c: number) => (hide ? '$••••' : formatCents(c)), text: (t: string) => (hide ? maskMoney(t) : t) }; };
export type Money = (c: number) => string;

/** The amount in words. An EXPECTED amount, never described as spent. An unknown amount is never shown as $0. */
export function amountWords(a: ExpectedAmount, money: Money): string {
  if (a.basis === 'unknown') return 'Amount not known';
  if (a.basis === 'variable') return a.cents === null ? 'Amount varies' : `Varies, about ${money(a.cents)}`;
  return a.cents === null ? 'Amount not known' : `${money(a.cents)} each time`;
}
export const amountOf = (d: ObligationData, today: string, money: Money) => amountWords(currentAmount(d, today), money);

export function StatusChip({ d }: { d: ObligationData }) {
  return <Chip tone={STATUS_TONE[d.status]} icon={d.status === 'active' ? false : undefined}>{STATUS_LABEL[d.status]}</Chip>;
}
export const TypeChip = ({ d }: { d: ObligationData }) => <Chip icon={false}>{TYPE_LABEL[d.type]}</Chip>;
export const NeedChip = ({ d }: { d: ObligationData }) => <Chip icon={false}>{NEED_LABEL[d.need]}</Chip>;

export const Lines = ({ lines }: { lines: string[] }) => (
  <ul className="plain bl-lines" aria-label="What will happen">
    {lines.map((l, i) => <li key={i}>{l}</li>)}
  </ul>
);
