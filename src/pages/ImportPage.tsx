import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  classifyRows,
  commitImport,
  detectMapping,
  normalizeRows,
  parseCsv,
  undoBatch,
  type ClassifiedRow,
  type CsvMapping,
  type ParsedCsv,
} from '../lib/csvImport';
import { formatCents } from '../lib/money';
import { EmptyLine, PageHeader } from '../ui/components';
import { StatusChip, type StatusTone } from '../ui/StatusChip';
import { IMPORT_STEPS, countWord, importStage } from './moneyPresentation';
import './money.css';

const CLS_LABEL = {
  new: 'New',
  duplicate: 'Already imported',
  match: 'Matches your entry',
  before_opening: 'Before opening date',
} as const;

/** How a row's result is drawn. The words are the importer's own; the tone only reinforces them. */
const CLS_TONE: Record<ClassifiedRow['cls'], StatusTone> = { new: 'done', duplicate: 'neutral', match: 'info', before_opening: 'warning' };

export default function ImportPage() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const batches = useLiveQuery(() => db.importBatches.orderBy('id').reverse().toArray(), []) ?? [];

  const [accountId, setAccountId] = useState<number | ''>('');
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [map, setMap] = useState<CsvMapping | null>(null);
  const [rows, setRows] = useState<ClassifiedRow[]>([]);
  const [includeOld, setIncludeOld] = useState(false);
  const [message, setMessage] = useState('');

  const parsed = useMemo(() => (csv && map && map.date && map.description ? normalizeRows(csv.rows, map) : null), [csv, map]);

  useEffect(() => {
    let live = true;
    if (parsed && accountId !== '') classifyRows(db, accountId, parsed.rows).then((r) => live && setRows(r));
    else setRows([]);
    return () => {
      live = false;
    };
  }, [parsed, accountId, batches.length]);

  const account = accounts.find((a) => a.id === accountId);
  const count = (c: ClassifiedRow['cls']) => rows.filter((r) => r.cls === c).length;
  const willAdd = count('new') + (includeOld ? count('before_opening') : 0);
  const stage = importStage({ hasFile: !!csv && !!map, hasPreview: !!parsed });

  async function onFile(f: File | undefined) {
    setMessage('');
    if (!f) return;
    const parsedCsv = parseCsv(await f.text());
    setFilename(f.name);
    setCsv(parsedCsv);
    const m = detectMapping(parsedCsv.headers);
    setMap({ ...m, invertSign: account?.kind === 'credit_card' && !!m.amount ? false : m.invertSign });
  }

  async function commit() {
    if (accountId === '') return;
    const b = await commitImport(db, accountId, filename, rows, { includeBeforeOpening: includeOld });
    setMessage(`Imported ${b.createdCount} new, matched ${b.matched.length} existing. Skipped ${count('duplicate')} duplicates.`);
    setCsv(null);
    setMap(null);
    setRows([]);
  }

  const col = (label: string, key: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'externalId', optional = false) => (
    <label className="f">{label}
      <select value={map?.[key] ?? ''} onChange={(e) => setMap({ ...map!, [key]: e.target.value || undefined })}>
        {optional && <option value="">(none)</option>}
        {!optional && <option value="">Choose…</option>}
        {csv?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mny-page mny-import">
      <PageHeader title="Import CSV" description="Bring in transactions from a bank CSV." />

      <ol className="mny-stepper" aria-label="Import steps">
        {IMPORT_STEPS.map((s, i) => {
          const at = IMPORT_STEPS.findIndex((x) => x.id === stage);
          const state = i < at ? 'done' : i === at ? 'current' : 'next';
          return (
            <li key={s.id} className={`mny-stepper-item is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="mny-stepper-n" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
              <span>{s.title}{state === 'done' && <span className="sr-only"> (done)</span>}</span>
            </li>
          );
        })}
      </ol>

      <section className="card" aria-labelledby="imp-file">
        <h2 id="imp-file" className="mny-h2 mny-h2--tight">1. Choose account and file</h2>
        <div className="mny-form mny-form--two">
          <label className="f">Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="f">CSV file
            <input type="file" accept=".csv,text/csv" disabled={accountId === ''} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        {csv && filename && <p className="mny-filename">Chosen file: <strong>{filename}</strong></p>}
        <p className="muted">
          Re-importing the same or an overlapping file is safe: rows already imported are skipped, and rows that match something you
          entered by hand mark it cleared instead of creating a duplicate. Nothing is written until you confirm.
        </p>
        {message && <div className="ok" role="status">{message}</div>}
      </section>

      {csv && map && (
        <>
          <section className="card" aria-labelledby="imp-map">
            <h2 id="imp-map" className="mny-h2 mny-h2--tight">2. Match the columns</h2>
            <div className="mny-form mny-form--wide">
              {col('Date', 'date')}
              {col('Description', 'description')}
              {col('Amount (signed)', 'amount', true)}
              {col('Debit column', 'debit', true)}
              {col('Credit column', 'credit', true)}
              {col('Bank transaction ID', 'externalId', true)}
              <label className="f">Date order
                <select value={map.dateOrder} onChange={(e) => setMap({ ...map, dateOrder: e.target.value as 'MDY' | 'DMY' })}>
                  <option value="MDY">Month/Day/Year</option>
                  <option value="DMY">Day/Month/Year</option>
                </select>
              </label>
            </div>
            <label className="mny-check">
              <input type="checkbox" checked={map.invertSign} onChange={(e) => setMap({ ...map, invertSign: e.target.checked })} />
              Flip signs (use if purchases show as positive, as many credit card exports do)
            </label>
            <p className="muted">If both a signed amount and debit/credit columns are set, the signed amount is used.</p>
            {!parsed && <p className="warn" role="status">Choose a Date column and a Description column to see the preview.</p>}
          </section>

          {parsed && (
            <section className="card" aria-labelledby="imp-prev">
              <h2 id="imp-prev" className="mny-h2 mny-h2--tight">3. Review and import</h2>
              <div className="mny-chiprow">
                {(Object.keys(CLS_LABEL) as (keyof typeof CLS_LABEL)[]).map((k) => (
                  <StatusChip key={k} tone={CLS_TONE[k]} icon={false}>{CLS_LABEL[k]}: {count(k)}</StatusChip>
                ))}
                {parsed.errors.length > 0 && <StatusChip tone="overdue">Unreadable rows: {parsed.errors.length}</StatusChip>}
              </div>
              {parsed.errors.length > 0 && (
                <ul className="warn mny-errlist" aria-label="Unreadable rows">
                  {parsed.errors.slice(0, 5).map((e) => <li key={e.line}>Line {e.line}: {e.reason}</li>)}
                </ul>
              )}
              {count('before_opening') > 0 && account && (
                <label className="mny-check">
                  <input type="checkbox" checked={includeOld} onChange={(e) => setIncludeOld(e.target.checked)} />
                  Also import {count('before_opening')} rows dated before this account’s opening date ({account.openingDate}). Leave unchecked if your starting balance already includes them.
                </label>
              )}
              <div className="mny-tablecard">
                <table className="mny-stack mny-preview" aria-label="Preview of the rows to import">
                  <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Result</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 200).map((r) => (
                      <tr key={r.line} className={r.cls === 'duplicate' ? 'muted' : ''}>
                        <td data-label="Date">{r.date}</td>
                        <td data-label="Description" className="mny-desc">{r.payee}</td>
                        <td className={`num ${r.amountCents < 0 ? 'neg' : 'pos'}`} data-label="Amount">{formatCents(r.amountCents)}</td>
                        <td data-label="Result"><StatusChip tone={CLS_TONE[r.cls]} icon={false}>{CLS_LABEL[r.cls]}</StatusChip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 && <p className="muted">Showing the first 200 of {rows.length} rows.</p>}
              <div className="mny-commit">
                <button className="primary" disabled={willAdd + count('match') === 0} onClick={commit}>
                  Import {willAdd} new{count('match') ? ` and match ${count('match')}` : ''}
                </button>
                <span className="muted">Check the sign of a few rows first; they should be negative for money out.</span>
              </div>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="imp-past">
        <h2 id="imp-past" className="mny-h2">Past imports {batches.length > 0 && <span className="mny-count">{countWord(batches.length, 'import')}</span>}</h2>
        {batches.length === 0 && <div className="card"><EmptyLine>None yet.</EmptyLine></div>}
        {batches.length > 0 && (
          <ul className="card flush mny-batches">
            {batches.map((b) => (
              <li key={b.id} className="mny-batch">
                <div className="mny-batch-main">
                  <strong className="mny-filename">{b.filename}</strong>
                  <div className="muted">{accounts.find((a) => a.id === b.accountId)?.name} · {new Date(b.importedAt).toLocaleString()}</div>
                </div>
                <div className="mny-batch-count">{b.createdCount} new, {b.matched.length} matched</div>
                <button className="link danger" aria-label={`Undo import of ${b.filename}`} onClick={() => confirm('Undo this import?') && undoBatch(db, b.id!)}>undo</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
