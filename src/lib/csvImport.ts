import Papa from 'papaparse';
import { matchRule } from './rules';
import type { FinanceDB } from '../db';
import type { ImportBatch, Txn } from '../types';
import { daysBetween, parseAmountToCents } from './money';

const MATCH_WINDOW_DAYS = 3;

export interface CsvMapping {
  date: string;
  description: string;
  /** Either a single signed amount column... */
  amount?: string;
  /** ...or separate debit/credit columns (both positive numbers). */
  debit?: string;
  credit?: string;
  externalId?: string;
  dateOrder: 'MDY' | 'DMY';
  /** Flip signs; many credit card exports list charges as positive. */
  invertSign: boolean;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  return { headers: res.meta.fields ?? [], rows: res.data };
}

export function detectMapping(headers: string[]): CsvMapping {
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const h = headers.find((x) => re.test(x));
      if (h) return h;
    }
    return undefined;
  };
  return {
    date: find(/^(transaction|trans\.?|posted?|posting) date$/i, /date/i) ?? '',
    description: find(/^(description|payee|merchant|name)$/i, /desc|payee|merchant|name|memo/i) ?? '',
    amount: find(/^amount$/i),
    debit: find(/debit|withdrawal/i),
    credit: find(/credit|deposit/i),
    externalId: find(/^(transaction id|reference( number)?|ref ?(no|#)?|id)$/i),
    dateOrder: 'MDY',
    invertSign: false,
  };
}

export function parseDate(raw: string, order: 'MDY' | 'DMY'): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    const [a, b] = [+m[1], +m[2]];
    y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    [mo, d] = order === 'MDY' ? [a, b] : [b, a];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export interface ParsedRow {
  line: number;
  date: string;
  amountCents: number;
  payee: string;
  externalId?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: { line: number; reason: string }[];
}

export function normalizeRows(rows: Record<string, string>[], map: CsvMapping): ParseResult {
  const out: ParsedRow[] = [];
  const errors: ParseResult['errors'] = [];
  rows.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const date = parseDate(r[map.date] ?? '', map.dateOrder);
    if (!date) return void errors.push({ line, reason: `Unreadable date "${r[map.date] ?? ''}"` });
    let cents: number | null;
    if (map.amount) cents = parseAmountToCents(r[map.amount]);
    else {
      const dRaw = r[map.debit ?? ''] ?? '';
      const cRaw = r[map.credit ?? ''] ?? '';
      if (!dRaw.trim() && !cRaw.trim()) cents = null;
      else cents = Math.abs(parseAmountToCents(cRaw) ?? 0) - Math.abs(parseAmountToCents(dRaw) ?? 0);
    }
    if (cents === null) return void errors.push({ line, reason: 'Unreadable amount' });
    if (map.invertSign) cents = -cents;
    const ext = map.externalId ? (r[map.externalId] ?? '').trim() : '';
    out.push({
      line,
      date,
      amountCents: cents,
      payee: (r[map.description] ?? '').trim().replace(/\s+/g, ' '),
      externalId: ext || undefined,
    });
  });
  return { rows: out, errors };
}

// ---- R2.1: pasted text and remembered column layouts ----

/** The one place both "Upload CSV file" and "Paste transactions" read text, so they cannot disagree. Commas, tabs (a spreadsheet copy), semicolons and pipes are auto-detected. */
export function parseTransactionText(text: string): { csv: ParsedCsv | null; problem: string | null } {
  if (!text.trim()) return { csv: null, problem: 'Nothing to read yet. Paste your rows, including the header line.' };
  const csv = parseCsv(text);
  if (csv.headers.length < 2) return { csv: null, problem: 'This does not look like columns of data. The first line should name the columns (for example Date, Description, Amount).' };
  if (csv.rows.length === 0) return { csv: null, problem: 'Only a header line was found. Include at least one transaction row under it.' };
  return { csv, problem: null };
}

/** What is remembered per account: which column title plays which role, the date order and the sign flip. Never any rows or file contents. */
export interface SavedLayout {
  v: 1;
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  externalId?: string;
  dateOrder: 'MDY' | 'DMY';
  invertSign: boolean;
}

/** One settings row per account, keyed by the account's id (never its name), so it rides the existing backup and sync with no migration. */
export const layoutKey = (accountId: number) => `import-layout:${accountId}`;

const ROLES = ['date', 'description', 'amount', 'debit', 'credit', 'externalId'] as const;
const OPTIONAL_ROLES = ['amount', 'debit', 'credit', 'externalId'] as const;

export function layoutFromMapping(map: CsvMapping): SavedLayout {
  const l: SavedLayout = { v: 1, date: map.date, description: map.description, dateOrder: map.dateOrder, invertSign: map.invertSign };
  for (const r of OPTIONAL_ROLES) if (map[r]) l[r] = map[r];
  return l;
}

/** Reads a stored value defensively: anything malformed counts as "nothing saved". */
export function readLayout(v: unknown): SavedLayout | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.date !== 'string' || typeof o.description !== 'string' || !o.date || !o.description) return null;
  if (o.dateOrder !== 'MDY' && o.dateOrder !== 'DMY') return null;
  if (typeof o.invertSign !== 'boolean') return null;
  const l: SavedLayout = { v: 1, date: o.date, description: o.description, dateOrder: o.dateOrder, invertSign: o.invertSign };
  for (const r of OPTIONAL_ROLES) {
    if (o[r] === undefined) continue;
    if (typeof o[r] !== 'string' || !o[r]) return null;
    l[r] = o[r] as string;
  }
  if (!l.amount && !l.debit && !l.credit) return null;
  return l;
}

export type LayoutCheck = { ok: true; map: CsvMapping } | { ok: false; reason: string };

/**
 * A saved layout is applied only when EVERY column it names is in the file exactly once (by title, ignoring capitals and spacing),
 * so a reordered file still works, but a missing, renamed or repeated column sends the person back to the manual choices.
 */
export function applySavedLayout(layout: SavedLayout, headers: string[]): LayoutCheck {
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
  const map: CsvMapping = { date: '', description: '', dateOrder: layout.dateOrder, invertSign: layout.invertSign };
  const missing: string[] = [];
  const repeated: string[] = [];
  for (const role of ROLES) {
    const want = layout[role];
    if (!want) continue;
    const hits = headers.filter((h) => norm(h) === norm(want));
    if (hits.length === 0) missing.push(want);
    else if (hits.length > 1) repeated.push(want);
    else map[role] = hits[0];
  }
  if (missing.length) return { ok: false, reason: `This file is missing the ${missing.map((m) => `"${m}"`).join(", ")} column${missing.length === 1 ? "" : "s"}.` };
  if (repeated.length) return { ok: false, reason: `This file has more than one ${repeated.map((m) => `"${m}"`).join(", ")} column.` };
  return { ok: true, map };
}

export async function loadLayout(d: FinanceDB, accountId: number): Promise<SavedLayout | null> {
  return readLayout((await d.settings.get(layoutKey(accountId)))?.value);
}

/** Called only after the person has confirmed an import. */
export async function saveLayout(d: FinanceDB, accountId: number, map: CsvMapping): Promise<void> {
  await d.settings.put({ key: layoutKey(accountId), value: layoutFromMapping(map) });
}

const normPayee = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Dedupe key. Identical same-day/same-amount/same-payee rows within one file get an
 * occurrence counter (0,1,2...) so two real coffees are not collapsed into one,
 * while re-importing an overlapping file still produces the same keys.
 */
export function fingerprint(accountId: number, r: ParsedRow, occurrence: number): string {
  return `${accountId}|${r.date}|${r.amountCents}|${normPayee(r.payee)}|${occurrence}`;
}

export type RowClass = 'new' | 'duplicate' | 'match' | 'before_opening';

export interface ClassifiedRow extends ParsedRow {
  fingerprint: string;
  cls: RowClass;
  matchTxnId?: number;
}

export async function classifyRows(d: FinanceDB, accountId: number, rows: ParsedRow[]): Promise<ClassifiedRow[]> {
  const acct = await d.accounts.get(accountId);
  if (!acct) throw new Error('Account not found');
  const existing = await d.txns.where('accountId').equals(accountId).toArray();
  const fps = new Set(existing.map((t) => t.fingerprint).filter(Boolean));
  const exts = new Set(existing.map((t) => t.externalId).filter(Boolean));
  const manual = existing.filter((t) => !t.fingerprint && !t.externalId);
  const claimed = new Set<number>();
  const seen = new Map<string, number>();
  const seenExt = new Set<string>();

  return rows.map((r) => {
    const key = `${r.date}|${r.amountCents}|${normPayee(r.payee)}`;
    const occ = seen.get(key) ?? 0;
    seen.set(key, occ + 1);
    const fp = fingerprint(accountId, r, occ);
    const base = { ...r, fingerprint: fp };

    if (r.externalId) {
      if (exts.has(r.externalId) || seenExt.has(r.externalId)) return { ...base, cls: 'duplicate' as const };
      seenExt.add(r.externalId);
    } else if (fps.has(fp)) return { ...base, cls: 'duplicate' as const };

    const cand = manual
      .filter(
        (t) =>
          !claimed.has(t.id!) &&
          t.amountCents === r.amountCents &&
          Math.abs(daysBetween(t.date, r.date)) <= MATCH_WINDOW_DAYS,
      )
      .sort((a, b) => Math.abs(daysBetween(a.date, r.date)) - Math.abs(daysBetween(b.date, r.date)))[0];
    if (cand) {
      claimed.add(cand.id!);
      return { ...base, cls: 'match' as const, matchTxnId: cand.id };
    }
    if (r.date < acct.openingDate) return { ...base, cls: 'before_opening' as const };
    return { ...base, cls: 'new' as const };
  });
}

/** Writes the import. `new` rows are added as cleared; `match` rows mark your manual entry cleared. */
export async function commitImport(
  d: FinanceDB,
  accountId: number,
  filename: string,
  rows: ClassifiedRow[],
  opts: { includeBeforeOpening?: boolean } = {},
): Promise<ImportBatch> {
  return d.transaction('rw', d.txns, d.importBatches, d.payeeRules, async () => {
    const rules = await d.payeeRules.toArray();
    const batch: ImportBatch = {
      accountId,
      filename,
      importedAt: new Date().toISOString(),
      createdCount: 0,
      matched: [],
    };
    const batchId = await d.importBatches.add(batch);
    batch.id = batchId;
    for (const r of rows) {
      if (r.cls === 'new' || (r.cls === 'before_opening' && opts.includeBeforeOpening)) {
        // Your payee rules categorize (and can rename) imported rows.
        const rule = matchRule(rules, r.payee, accountId);
        const t: Txn = {
          accountId,
          date: r.date,
          amountCents: r.amountCents,
          payee: rule?.rename?.trim() ? rule.rename.trim() : r.payee,
          memo: '',
          status: 'cleared',
          categoryId: rule?.categoryId ?? null,
          fingerprint: r.fingerprint,
          externalId: r.externalId,
          importBatchId: batchId,
        };
        await d.txns.add(t);
        batch.createdCount++;
      } else if (r.cls === 'match' && r.matchTxnId) {
        const cur = await d.txns.get(r.matchTxnId);
        if (!cur) continue;
        batch.matched.push({ txnId: cur.id!, prevStatus: cur.status });
        await d.txns.update(cur.id!, {
          status: cur.status === 'reconciled' ? 'reconciled' : 'cleared',
          fingerprint: r.fingerprint,
          externalId: r.externalId,
        });
      }
    }
    await d.importBatches.put(batch);
    return batch;
  });
}

/** Reverses an import. Transfer halves created by an import are unlinked, never silently deleted. */
export async function undoBatch(d: FinanceDB, batchId: number) {
  await d.transaction('rw', d.txns, d.importBatches, async () => {
    const batch = await d.importBatches.get(batchId);
    if (!batch) return;
    const created = await d.txns.where('importBatchId').equals(batchId).toArray();
    for (const t of created) {
      if (t.transferTxnId) await d.txns.update(t.transferTxnId, { transferTxnId: null });
      await d.txns.delete(t.id!);
    }
    for (const m of batch.matched) {
      await d.txns.update(m.txnId, { status: m.prevStatus, fingerprint: undefined, externalId: undefined });
    }
    await d.importBatches.delete(batchId);
  });
}
