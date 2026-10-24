import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { canBePrimary, getPrimaryAccountId, pickPrimary, setPrimaryAccountId } from './primaryAccount';
import { centsText, keypadEnabled, keypadText } from './amountEntry';
import { moveTxn, createTransfer, updateTxn } from './transfers';
import { parseAmountToCents } from './money';
import type { Account, Txn } from '../types';

let n = 0;
let d: FinanceDB;
const acct = (name: string, kind: Account['kind'] = 'checking', extra: Partial<Account> = {}): Account => ({ name, kind, openingBalanceCents: 0, openingDate: '2026-01-01', ...extra });
const txn = (accountId: number, p: Partial<Txn> = {}): Txn => ({ accountId, date: '2026-03-01', amountCents: -1245, payee: 'Cafe', memo: 'lunch', status: 'cleared', categoryId: 7, ...p });

describe('moving a transaction to another account', () => {
  let chk: number, sav: number, card: number;
  beforeEach(async () => {
    d = new FinanceDB(`move-${n++}`);
    chk = await d.accounts.add(acct('Checking'));
    sav = await d.accounts.add(acct('Savings', 'savings'));
    card = await d.accounts.add(acct('Card', 'credit_card'));
  });

  it('moves an ordinary transaction and keeps everything else', async () => {
    const id = await d.txns.add(txn(chk, { splits: [{ categoryId: 1, amountCents: -1000 }, { categoryId: 2, amountCents: -245 }] }));
    expect(await moveTxn(d, id, card)).toBe('moved');
    const t = (await d.txns.get(id))!;
    expect(t).toMatchObject({ accountId: card, amountCents: -1245, payee: 'Cafe', memo: 'lunch', status: 'cleared', categoryId: 7, date: '2026-03-01' });
    expect(t.splits).toHaveLength(2);
    expect(await d.txns.where('accountId').equals(chk).count()).toBe(0);
  });

  it('moving to the account it is already on does nothing', async () => {
    const id = await d.txns.add(txn(chk));
    expect(await moveTxn(d, id, chk)).toBe('same');
  });

  it('an unknown transaction or account is refused', async () => {
    const id = await d.txns.add(txn(chk));
    await expect(moveTxn(d, 9999, sav)).rejects.toThrow(/not found/);
    await expect(moveTxn(d, id, 9999)).rejects.toThrow(/Account not found/);
    expect((await d.txns.get(id))!.accountId).toBe(chk);
  });

  it('a reconciled transaction goes back to cleared; others keep their status', async () => {
    const rec = await d.txns.add(txn(chk, { status: 'reconciled' }));
    const pend = await d.txns.add(txn(chk, { status: 'pending' }));
    await moveTxn(d, rec, sav);
    await moveTxn(d, pend, sav);
    expect((await d.txns.get(rec))!.status).toBe('cleared');
    expect((await d.txns.get(pend))!.status).toBe('pending');
  });

  it('keeps the bank id and dedupe key but drops the link to the import, so undoing that import leaves it alone', async () => {
    const id = await d.txns.add(txn(chk, { externalId: 'bank-1', fingerprint: 'fp-1', importBatchId: 5 }));
    await moveTxn(d, id, sav);
    expect(await d.txns.get(id)).toMatchObject({ externalId: 'bank-1', fingerprint: 'fp-1', importBatchId: null });
  });

  it('balances follow: the old account loses the amount and the new one gains it', async () => {
    const id = await d.txns.add(txn(chk, { amountCents: -5000 }));
    const bal = async (a: number) => (await d.txns.where('accountId').equals(a).toArray()).reduce((s, t) => s + t.amountCents, 0);
    expect(await bal(chk)).toBe(-5000);
    await moveTxn(d, id, sav);
    expect(await bal(chk)).toBe(0);
    expect(await bal(sav)).toBe(-5000);
  });

  describe('transfers', () => {
    it('either side can move; the other side stays, and both payees name the right accounts', async () => {
      const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: chk, toAccountId: sav, date: '2026-03-02', amountCents: 20000 });
      const card2 = await d.accounts.add(acct('Other checking'));
      await moveTxn(d, fromTxnId, card2); // the money actually left "Other checking"
      const from = (await d.txns.get(fromTxnId))!;
      const to = (await d.txns.get(toTxnId))!;
      expect(from.accountId).toBe(card2);
      expect(to.accountId).toBe(sav);
      expect(from.payee).toBe('Transfer to Savings');
      expect(to.payee).toBe('Transfer from Other checking');
      expect(from.transferTxnId).toBe(toTxnId);
      expect(to.transferTxnId).toBe(fromTxnId);
      expect(from.amountCents + to.amountCents).toBe(0);
      // and the receiving side
      await moveTxn(d, toTxnId, card);
      expect((await d.txns.get(toTxnId))!.accountId).toBe(card);
      expect((await d.txns.get(fromTxnId))!.payee).toBe('Transfer to Card');
      expect((await d.txns.get(toTxnId))!.payee).toBe('Transfer from Other checking');
    });

    it('both sides cannot end up on the same account', async () => {
      const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: chk, toAccountId: sav, date: '2026-03-02', amountCents: 20000 });
      await expect(moveTxn(d, fromTxnId, sav)).rejects.toThrow(/two different accounts/);
      await expect(moveTxn(d, toTxnId, chk)).rejects.toThrow(/two different accounts/);
      expect((await d.txns.get(fromTxnId))!.accountId).toBe(chk);
      expect((await d.txns.get(toTxnId))!.accountId).toBe(sav);
    });

    it('a reconciled side goes back to cleared without touching the other side', async () => {
      const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: chk, toAccountId: sav, date: '2026-03-02', amountCents: 20000, status: 'reconciled' });
      await moveTxn(d, fromTxnId, card);
      expect((await d.txns.get(fromTxnId))!.status).toBe('cleared');
      expect((await d.txns.get(toTxnId))!.status).toBe('reconciled'); // its own account's balance did not change
    });

    it('editing the amount afterwards still keeps both sides in step', async () => {
      const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: chk, toAccountId: sav, date: '2026-03-02', amountCents: 20000 });
      await moveTxn(d, fromTxnId, card);
      await updateTxn(d, fromTxnId, { amountCents: -30000 });
      expect((await d.txns.get(toTxnId))!.amountCents).toBe(30000);
    });
  });
});

describe('keystroke-style amounts', () => {
  const type = (digits: string) => [...digits].reduce((text, ch) => keypadText(text + ch), '');

  it('typing 1, 2, 4, 5 gives 0.01, 0.12, 1.24, 12.45', () => {
    expect(keypadText('1')).toBe('0.01');
    expect(keypadText('0.01' + '2')).toBe('0.12');
    expect(keypadText('0.12' + '4')).toBe('1.24');
    expect(keypadText('1.24' + '5')).toBe('12.45');
    expect(type('1245')).toBe('12.45');
  });

  it('Backspace takes the last digit off, down to empty', () => {
    expect(keypadText('12.4')).toBe('1.24'); // 12.45 with the 5 removed
    expect(keypadText('1.2')).toBe('0.12');
    expect(keypadText('0.0')).toBe('');
    expect(keypadText('')).toBe('');
  });

  it('thousands are separated and still read back correctly', () => {
    expect(type('120050')).toBe('1,200.50');
    expect(parseAmountToCents(type('120050'))).toBe(120050);
    expect(parseAmountToCents(type('1245'))).toBe(1245);
  });

  it('leading zeros do nothing, and there is a limit instead of a runaway number', () => {
    expect(type('0005')).toBe('0.05');
    expect(type('0')).toBe('');
    expect(type('999999999999999')).toBe('999,999,999.99'); // 11 digits kept
  });

  it('a typed decimal point or sign is ignored (the direction is chosen separately)', () => {
    expect(type('12.45')).toBe('12.45'); // 1, 2, ., 4, 5 -> digits 1245
    expect(keypadText('-12.45')).toBe('12.45');
  });

  it('a pasted whole amount shows as typed, without the sign', () => {
    expect(centsText(parseAmountToCents('$1,200.50')!)).toBe('1,200.50');
    expect(centsText(parseAmountToCents('12.45')!)).toBe('12.45');
    expect(centsText(-1245)).toBe('12.45');
    expect(centsText(0)).toBe('');
  });

  it('is on unless switched off', () => {
    expect(keypadEnabled()).toBe(true);
  });
});

describe('primary payment account', () => {
  let chk: number, card: number, loan: number;
  beforeEach(async () => {
    d = new FinanceDB(`primary-${n++}`);
    chk = await d.accounts.add(acct('Checking'));
    card = await d.accounts.add(acct('Card', 'credit_card'));
    loan = await d.accounts.add(acct('Mortgage', 'loan'));
  });

  it('none until set, then it can be set, changed and cleared', async () => {
    expect(await getPrimaryAccountId(d)).toBeNull();
    await setPrimaryAccountId(d, chk);
    expect(await getPrimaryAccountId(d)).toBe(chk);
    await setPrimaryAccountId(d, card);
    expect(await getPrimaryAccountId(d)).toBe(card);
    await setPrimaryAccountId(d, null);
    expect(await getPrimaryAccountId(d)).toBeNull();
  });

  it('a loan, a closed account, or one that does not exist cannot be primary', async () => {
    await expect(setPrimaryAccountId(d, loan)).rejects.toThrow(/cannot be the primary/);
    await expect(setPrimaryAccountId(d, 9999)).rejects.toThrow(/cannot be the primary/);
    await d.accounts.update(card, { closed: true });
    await expect(setPrimaryAccountId(d, card)).rejects.toThrow(/cannot be the primary/);
    expect(await getPrimaryAccountId(d)).toBeNull();
  });

  it('pickPrimary only offers an account that is still usable', async () => {
    const all = await d.accounts.toArray();
    expect(pickPrimary(all, null)).toBeUndefined();
    expect(pickPrimary(all, chk)?.name).toBe('Checking');
    expect(pickPrimary(all, loan)).toBeUndefined();
    expect(pickPrimary(all, 9999)).toBeUndefined();
    await d.accounts.update(chk, { closed: true });
    expect(pickPrimary(await d.accounts.toArray(), chk)).toBeUndefined(); // closed after being chosen: quietly not used
    expect(canBePrimary(all.find((a) => a.id === loan)!)).toBe(false);
  });

  it('is saved with the data: it is in the backup and comes back on restore', async () => {
    await setPrimaryAccountId(d, card);
    const file = await exportAll(d);
    expect(file.settings).toContainEqual(expect.objectContaining({ key: 'primaryAccountId', value: card }));
    await d.settings.clear();
    expect(await getPrimaryAccountId(d)).toBeNull();
    await importAll(d, file);
    expect(await getPrimaryAccountId(d)).toBe(card);
  });
});
