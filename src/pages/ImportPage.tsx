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
import { PageHeader } from '../ui/components';

const CLS_LABEL = {
  new: 'New',
  duplicate: 'Already imported',
  match: 'Matches your entry',
  before_opening: 'Before opening date',
} as const;

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
    <>
      <PageHeader title="Import CSV" description="Bring in transactions from a bank CSV." />
      <div className="card">
        <div className="row">
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
        <p className="muted">
          Re-importing the same or an overlapping file is safe: rows already imported are skipped, and rows that match something you
          entered by hand mark it cleared instead of creating a duplicate. Nothing is written until you confirm.
        </p>
        {message && <div className="ok">{message}</div>}
      </div>

      {csv && map && (
        <>
          <h2>Column mapping</h2>
          <div className="card">
            <div className="grid">
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
            <label className="row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={map.invertSign} onChange={(e) => setMap({ ...map, invertSign: e.target.checked })} />
              Flip signs (use if purchases show as positive, as many credit card exports do)
            </label>
            <p className="muted">If both a signed amount and debit/credit columns are set, the signed amount is used.</p>
          </div>

          {parsed && (
            <>
              <h2>Preview</h2>
              <div className="row">
                {(Object.keys(CLS_LABEL) as (keyof typeof CLS_LABEL)[]).map((k) => (
                  <span key={k} className="badge">{CLS_LABEL[k]}: {count(k)}</span>
                ))}
                {parsed.errors.length > 0 && <span className="badge warn">Unreadable rows: {parsed.errors.length}</span>}
              </div>
              {parsed.errors.length > 0 && (
                <ul className="warn">
                  {parsed.errors.slice(0, 5).map((e) => <li key={e.line}>Line {e.line}: {e.reason}</li>)}
                </ul>
              )}
              {count('before_opening') > 0 && account && (
                <label className="row">
                  <input type="checkbox" checked={includeOld} onChange={(e) => setIncludeOld(e.target.checked)} />
                  Also import {count('before_opening')} rows dated before this account’s opening date ({account.openingDate}). Leave unchecked if your starting balance already includes them.
                </label>
              )}
              <table>
                <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Result</th></tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className={r.cls === 'duplicate' ? 'muted' : ''}>
                      <td>{r.date}</td>
                      <td>{r.payee}</td>
                      <td className={`num ${r.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(r.amountCents)}</td>
                      <td>{CLS_LABEL[r.cls]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && <p className="muted">Showing the first 200 of {rows.length} rows.</p>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="primary" disabled={willAdd + count('match') === 0} onClick={commit}>
                  Import {willAdd} new{count('match') ? ` and match ${count('match')}` : ''}
                </button>
                <span className="muted">Check the sign of a few rows first; they should be negative for money out.</span>
              </div>
            </>
          )}
        </>
      )}

      <h2>Past imports</h2>
      {batches.length === 0 && <p className="muted">None yet.</p>}
      <table>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>{new Date(b.importedAt).toLocaleString()}</td>
              <td>{accounts.find((a) => a.id === b.accountId)?.name}</td>
              <td>{b.filename}</td>
              <td>{b.createdCount} new, {b.matched.length} matched</td>
              <td><button className="link danger" onClick={() => confirm('Undo this import?') && undoBatch(db, b.id!)}>undo</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
