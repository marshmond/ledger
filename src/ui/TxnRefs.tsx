import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../core/time';
import { db } from '../db';
import { formatCents } from '../lib/money';
import { buildRows, EMPTY_FILTER, matches, sortRows, DEFAULT_SORT } from '../lib/txnQuery';
import { chooseCost, type CostChoice } from '../lib/costSource';
import { loadTxnMap, lookupOfMap } from '../lib/txnLookup';
import { isSpendingTxn, makeTxnRef, pieceKey, resolveRef, type ResolvedRef, type TxnRef } from '../lib/txnRef';

/** "Paid $45.00" for money out, "Money back $20.00" for a refund. The sign follows Finance: negative = out. */
export const spendText = (spendCents: number) => (spendCents >= 0 ? `Paid ${formatCents(spendCents)}` : `Money back ${formatCents(-spendCents)}`);
/** The hidden form of an amount line: the direction (paid or money back) stays, the figure does not. */
export const MASKED_AMOUNT = '$••••';
export const spendTextMasked = (spendCents: number) => (spendCents >= 0 ? `Paid ${MASKED_AMOUNT}` : `Money back ${MASKED_AMOUNT}`);
/** What the picker shows for an amount: the figure, or the masked form while Hide Amounts is on and the owner has not chosen to reveal. */
export const pickerSpendText = (spendCents: number, hide: boolean, revealed: boolean) => (hide && !revealed ? spendTextMasked(spendCents) : spendText(spendCents));

export const financeLink = (txnId: number) => `#/ledger/transactions?txn=${txnId}`;

/** Resolves references against the live transactions. Re-runs by itself when a transaction changes in Finance. */
export function useResolved(refs: TxnRef[]): ResolvedRef[] | undefined {
  const key = refs.map(pieceKey).join(',');
  return useLiveQuery(async () => {
    const lookup = lookupOfMap(await loadTxnMap(refs, db));
    return refs.map((r) => resolveRef(r, lookup));
  }, [key, refs.map((r) => `${r.snapshot.amountCents}|${r.fp?.amountCents}|${r.fp?.splitCount}`).join(',')]);
}

/** One linked transaction piece: what it is now, whether it needs review, and a way into Finance. */
const MONEY = /[$]\s?[\d,]+(\.\d\d)?/g;
export const maskMoney = (t: string) => t.replace(MONEY, () => MASKED_AMOUNT);

export function RefLine({ r, onRemove, extra, hide = false }: { r: ResolvedRef; onRemove?: () => void; extra?: React.ReactNode; /** Hide Amounts is on: show no money figures. */ hide?: boolean }) {
  const t = r.txn;
  const part = r.ref.splitIndex !== undefined;
  const payee = t?.payee || r.ref.snapshot.payee || '(no payee)';
  const when = t?.date || r.ref.snapshot.date;
  return (
    <li className={`as-txn ${r.needsReview ? 'review' : ''}`}>
      <span className="as-txn-main">
        {t ? <a href={financeLink(t.id!)} aria-label={`Open this transaction in Finance: ${payee}`}><strong>{payee}</strong></a> : <strong>{payee}</strong>}
        <span className="muted small">
          {when ? ` · ${dayLabel(when, { year: true })}` : ''}{part ? ` · part ${r.ref.splitIndex! + 1}${r.ref.fp ? ` of ${r.ref.fp.splitCount}` : ''}` : ''}
        </span>
        {extra}
      </span>
      <span className="as-txn-amt">
        {r.needsReview ? <span className="as-review-chip">Needs review · not counted</span> : <strong>{hide ? '$••••' : spendText(r.spendCents)}</strong>}
        {!r.needsReview && r.state === 'changed' && <span className="as-note-chip">changed in Finance</span>}
      </span>
      {r.note && <span className={`small as-txn-note ${r.needsReview ? 'warn' : 'muted'}`} role={r.needsReview ? 'alert' : undefined}>{hide ? maskMoney(r.note) : r.note}</span>}
      {onRemove && <button type="button" className="link" onClick={onRemove} aria-label={`Remove the link to ${payee}`}>Remove</button>}
    </li>
  );
}

/** The deliberate, temporary "Show amounts" control (only when Hide Amounts is on). A real button, so keyboard and screen readers work. */
export function RevealControl({ hide, revealed, onToggle }: { hide: boolean; revealed: boolean; onToggle: () => void }) {
  if (!hide) return null;
  return (
    <div className="row">
      <button type="button" className="btn" aria-pressed={revealed} onClick={onToggle}>{revealed ? 'Hide amounts again' : 'Show amounts'}</button>
      <span className="muted small" role="status">{revealed ? 'Amounts are showing in this list only.' : 'Hide Amounts is on, so amounts are hidden here. Payee, date and account are enough to identify a payment; use Show amounts only if you need the figures.'}</span>
    </div>
  );
}

/**
 * A read-only picker for existing Finance transactions. It never changes one. Transfers and setup entries are not offered. A whole
 * transaction and its parts cannot both be chosen. Searches with Finance's own filter code (payee or note, date box, amount box).
 */
export function TxnPicker({ chosen, onPick, onClose, hide = false }: { chosen: TxnRef[]; onPick: (r: TxnRef) => void; onClose: () => void; /** Hide Amounts is on: no figures until the owner chooses "Show amounts" (it resets when the picker closes). Off by default, so Home & Assets is unchanged. */ hide?: boolean }) {
  const txns = useLiveQuery(() => db.txns.toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const [text, setText] = useState('');
  const [dateBox, setDateBox] = useState('');
  const [amountBox, setAmountBox] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const amt = (c: number) => pickerSpendText(c, hide, revealed);
  const LIMIT = 30;

  const catName = (id: number | null) => (id === null ? 'Uncategorized' : cats.find((c) => c.id === id)?.name ?? 'Unknown');
  const rows = useMemo(() => {
    const spendable = (txns ?? []).filter(isSpendingTxn);
    const all = buildRows(spendable, accounts, cats);
    const f = { ...EMPTY_FILTER, text, colDate: dateBox, colAmount: amountBox, hideTransfers: true };
    return sortRows(all.filter((r) => matches(r, f)), DEFAULT_SORT);
  }, [txns, accounts, cats, text, dateBox, amountBox]);

  const have = new Set(chosen.map(pieceKey));
  const wholeOf = new Set(chosen.filter((c) => c.splitIndex === undefined).map((c) => c.txnId));
  const partsOf = new Set(chosen.filter((c) => c.splitIndex !== undefined).map((c) => c.txnId));

  return (
    <div className="as-picker" role="group" aria-label="Pick a Finance transaction">
      <p className="muted small">Pick an existing transaction. Nothing in Finance is changed, and transfers are not shown. Money out is "Paid"; a refund is "Money back" and lowers the total.</p>
      <RevealControl hide={hide} revealed={revealed} onToggle={() => setRevealed(!revealed)} />
      <div className="as-two">
        <label className="f">Payee or note<input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. hardware" autoFocus /></label>
        <div className="as-two">
          <label className="f">Date<input value={dateBox} onChange={(e) => setDateBox(e.target.value)} placeholder="2026-03 or 03/15" /></label>
          <label className="f">Amount<input value={amountBox} onChange={(e) => setAmountBox(e.target.value)} placeholder="45 or >100" inputMode="decimal" /></label>
        </div>
      </div>
      {txns === undefined ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No matching transactions.</p> : (
        <ul className="plain as-pick-list">
          {rows.slice(0, LIMIT).map((r) => {
            const t = r.txn;
            const id = t.id!;
            const splits = t.splits ?? [];
            const wholeTaken = have.has(`${id}:w`);
            const wholeBlocked = partsOf.has(id);
            return (
              <li key={id} className="as-pick">
                <div className="as-pick-head">
                  <span className="as-txn-main"><strong>{t.payee || '(no payee)'}</strong><span className="muted small"> · {dayLabel(t.date, { year: true })} · {r.accountName}{t.memo ? ` · ${t.memo}` : ''}</span></span>
                  <strong>{amt(-t.amountCents)}</strong>
                </div>
                <div className="as-pick-actions">
                  <button type="button" className="btn" disabled={wholeTaken || wholeBlocked} onClick={() => onPick(makeTxnRef(t))} aria-label={`Link the whole transaction: ${t.payee} ${amt(-t.amountCents)}`}>
                    {wholeTaken ? 'Already linked' : 'Link whole transaction'}
                  </button>
                  {splits.length > 1 && <button type="button" className="link" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>{open === id ? 'Hide parts' : `Pick one of its ${splits.length} parts`}</button>}
                  {wholeBlocked && <span className="muted small">One of its parts is already linked.</span>}
                </div>
                {open === id && (
                  <ul className="plain as-parts">
                    {splits.map((s, i) => {
                      const taken = have.has(`${id}:${i}`);
                      return (
                        <li key={i}>
                          <span>Part {i + 1}: {catName(s.categoryId)} · <strong>{amt(-s.amountCents)}</strong></span>
                          <button type="button" className="btn" disabled={taken || wholeOf.has(id)} onClick={() => onPick(makeTxnRef(t, i))} aria-label={`Link part ${i + 1} of ${splits.length}: ${catName(s.categoryId)} ${amt(-s.amountCents)}`}>
                            {taken ? 'Linked' : wholeOf.has(id) ? 'Whole is linked' : 'Link this part'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > LIMIT && <p className="muted small">Showing the newest {LIMIT} of {rows.length}. Type more to narrow it.</p>}
      <div className="row"><button type="button" className="btn" onClick={onClose}>Done picking</button></div>
    </div>
  );
}

/**
 * "Typed amount" or "From Finance". The owner chooses which source counts. Switching keeps what is on screen until Save; when Save would
 * drop the other source, a box naming exactly what must be ticked first (`ack`).
 */
export function CostSourceField({ label, choice, setChoice, text, setText, refs, setRefs, parse, ack, setAck, help, idp, manualLabel = 'Typed amount', amountLabel = 'Amount', financeIntro, hide = false }: {
  hide?: boolean;
  label: string; manualLabel?: string; amountLabel?: string; financeIntro?: string; choice: CostChoice; setChoice: (c: CostChoice) => void; text: string; setText: (t: string) => void;
  refs: TxnRef[]; setRefs: (r: TxnRef[]) => void; parse: (t: string) => number | null | undefined; ack: boolean; setAck: (b: boolean) => void; help: string; idp: string;
}) {
  const [picking, setPicking] = useState(false);
  const resolved = useResolved(refs);
  const chosen = chooseCost(choice, text, refs, parse);
  const pick = (r: TxnRef) => { setRefs([...refs, r]); setAck(false); };
  return (
    <fieldset className="as-source">
      <legend>{label} <span className="muted">(optional)</span></legend>
      <div className="as-radios" role="radiogroup" aria-label={`Where the ${label.toLowerCase()} comes from`}>
        <label><input type="radio" name={`${idp}-src`} checked={choice === 'manual'} onChange={() => { setChoice('manual'); setAck(false); }} /> {manualLabel}</label>
        <label><input type="radio" name={`${idp}-src`} checked={choice === 'finance'} onChange={() => { setChoice('finance'); setAck(false); }} /> From Finance transactions</label>
      </div>
      {choice === 'manual' ? (
        <label className="f">{amountLabel}
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="Leave blank if unknown" aria-describedby={`${idp}-help`} />
          <span id={`${idp}-help`} className="muted small">{help}</span>
        </label>
      ) : (
        <div>
          <p className="muted small">{financeIntro ?? 'The amount comes from the transactions you link and follows them if they change in Finance. Nothing here adds anything to your accounts or budget.'}</p>
          {refs.length === 0 ? <p className="muted small">No transaction linked yet.</p> : (
            <ul className="plain as-txns">{(resolved ?? []).map((r) => <RefLine key={r.key} r={r} hide={hide} onRemove={() => { setRefs(refs.filter((x) => pieceKey(x) !== r.key)); setAck(false); }} />)}</ul>
          )}
          {picking ? <TxnPicker chosen={refs} onPick={pick} onClose={() => setPicking(false)} hide={hide} /> : <button type="button" className="btn" onClick={() => setPicking(true)}>{refs.length ? 'Link another transaction' : 'Link a transaction'}</button>}
        </div>
      )}
      {chosen.dropped && (
        <label className="as-check warn"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Saving removes {chosen.dropped}. Tick to confirm{choice === 'finance' ? ', or switch back to keep it' : ', or switch back to keep them'}.</label>
      )}
    </fieldset>
  );
}
