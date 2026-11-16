import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  classifyRows,
  commitImport,
  applySavedLayout,
  detectMapping,
  loadLayout,
  normalizeRows,
  parseTransactionText,
  saveLayout,
  undoBatch,
  type ClassifiedRow,
  type CsvMapping,
  type ParsedCsv,
} from '../lib/csvImport';
import { formatCents } from '../lib/money';
import { allTxnReferenceProviders } from '../core/registry';
import { deletionWords, planTxnDeletion, type DeletionPlan } from '../lib/txnDeletion';
import { EmptyLine, PageHeader } from '../ui/components';
import ConfirmDialog from '../shell/ConfirmDialog';
import { MatchesNotice } from '../shell/PossibleMatches';
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
  // D20.1B (NC-15): the past import whose "undo" was pressed, by id. Nothing is changed until the dialog's own button is pressed.
  const [askUndo, setAskUndo] = useState<number | null>(null);
  const undoRow = askUndo === null ? undefined : batches.find((x) => x.id === askUndo);
  // R2.2: what household records (bills, visits, maintenance records, projects) now point at the transactions this import added. READ ONLY; looked at when the dialog opens.
  const [undoPlan, setUndoPlan] = useState<DeletionPlan | 'failed' | null>(null);
  const planUndo = async (batchId: number) => planTxnDeletion(db, (await db.txns.where('importBatchId').equals(batchId).primaryKeys()) as number[], allTxnReferenceProviders());
  useEffect(() => {
    setUndoPlan(null);
    if (askUndo === null) return;
    let live = true;
    planUndo(askUndo).then((p) => live && setUndoPlan(p)).catch(() => live && setUndoPlan('failed'));
    return () => { live = false; };
  }, [askUndo]);

  const [accountId, setAccountId] = useState<number | ''>('');
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [map, setMap] = useState<CsvMapping | null>(null);
  const [rows, setRows] = useState<ClassifiedRow[]>([]);
  const [includeOld, setIncludeOld] = useState(false);
  const [message, setMessage] = useState('');
  // R2.1: how the rows arrive, the pasted text (kept only on this screen), and whether a remembered layout was used.
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [problem, setProblem] = useState('');
  const [layoutState, setLayoutState] = useState<{ kind: 'none' } | { kind: 'saved' } | { kind: 'mismatch'; reason: string }>({ kind: 'none' });
  const [editing, setEditing] = useState(false);
  // R2.2: the transactions the last import ADDED (already saved), so "Possible matches" can offer to look at them. Optional; the import is complete without it.
  const [importedIds, setImportedIds] = useState<number[]>([]);

  const parsed = useMemo(() => (csv && map && map.date && map.description ? normalizeRows(csv.rows, map) : null), [csv, map]);

  useEffect(() => {
    let live = true;
    if (parsed && accountId !== '') classifyRows(db, accountId, parsed.rows).then((r) => live && setRows(r));
    else setRows([]);
    return () => {
      live = false;
    };
  }, [parsed, accountId, batches.length]);

  // Choosing the columns: the account's remembered layout when this file fits it, otherwise the usual guess. Nothing is written here.
  useEffect(() => {
    if (!csv) { setMap(null); setLayoutState({ kind: 'none' }); setEditing(false); return; }
    let live = true;
    (async () => {
      const saved = accountId === '' ? null : await loadLayout(db, accountId);
      if (!live) return;
      if (saved) {
        const check = applySavedLayout(saved, csv.headers);
        if (check.ok) { setMap(check.map); setLayoutState({ kind: 'saved' }); setEditing(false); return; }
        setLayoutState({ kind: 'mismatch', reason: check.reason });
      } else setLayoutState({ kind: 'none' });
      setMap(detectMapping(csv.headers));
      setEditing(true);
    })();
    return () => { live = false; };
  }, [csv, accountId]);

  const account = accounts.find((a) => a.id === accountId);
  const count = (c: ClassifiedRow['cls']) => rows.filter((r) => r.cls === c).length;
  const willAdd = count('new') + (includeOld ? count('before_opening') : 0);
  const stage = importStage({ hasFile: !!csv && !!map, hasPreview: !!parsed });

  function chooseMode(m: 'file' | 'paste') {
    if (m === mode) return;
    setMode(m);
    setCsv(null); setMap(null); setRows([]); setFilename(''); setProblem(''); setMessage(''); setImportedIds([]);
  }

  /** Upload and paste both end here, so the same text always gives the same rows. */
  function load(text: string, name: string) {
    setMessage('');
    setImportedIds([]);
    const r = parseTransactionText(text);
    setProblem(r.problem ?? '');
    setFilename(r.csv ? name : '');
    setCsv(r.csv);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    load(await f.text(), f.name);
  }

  async function commit() {
    if (accountId === '' || !map) return;
    const b = await commitImport(db, accountId, filename, rows, { includeBeforeOpening: includeOld });
    // The layout is remembered only now, after the person confirmed. A failure here never undoes or blocks the import.
    let remembered = false;
    try { await saveLayout(db, accountId, map); remembered = true; } catch { /* the import itself succeeded */ }
    setMessage(`Imported ${b.createdCount} new, matched ${b.matched.length} existing. Skipped ${count('duplicate')} duplicates.${remembered ? ` Your column layout is remembered for ${account?.name ?? 'this account'}.` : ''}`);
    // R2.2: only transactions that were actually saved are looked at. A failure here changes nothing about the import.
    try { setImportedIds((await db.txns.where('importBatchId').equals(b.id!).primaryKeys()) as number[]); } catch { setImportedIds([]); }
    setCsv(null);
    setMap(null);
    setRows([]);
    setPasteText('');
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
      <PageHeader title="Import transactions" description="Bring in transactions from a bank CSV file or by pasting rows." />

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
        <h2 id="imp-file" className="mny-h2 mny-h2--tight">1. Choose account and transactions</h2>
        <div className="mny-form mny-form--two">
          <label className="f">Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mny-modes" role="radiogroup" aria-label="How to bring in transactions">
          <button type="button" role="radio" aria-checked={mode === 'file'} className="mny-mode" onClick={() => chooseMode('file')}>Upload CSV file</button>
          <button type="button" role="radio" aria-checked={mode === 'paste'} className="mny-mode" onClick={() => chooseMode('paste')}>Paste transactions</button>
        </div>
        {mode === 'file' ? (
          <label className="f">CSV file
            <input type="file" accept=".csv,text/csv" disabled={accountId === ''} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        ) : (
          <>
            <label className="f">Pasted transactions
              <textarea className="mny-paste" value={pasteText} disabled={accountId === ''} spellCheck={false}
                placeholder={'Date,Description,Amount\n2026-11-01,Grocery Store,-85.42'}
                onChange={(e) => setPasteText(e.target.value)} />
            </label>
            <div className="mny-commit">
              <button type="button" disabled={accountId === '' || !pasteText.trim()} onClick={() => load(pasteText, `Pasted transactions, ${new Date().toLocaleDateString()}`)}>Read pasted rows</button>
              <span className="muted">Include the header line. Copying cells from a spreadsheet works too.</span>
            </div>
          </>
        )}
        {accountId === '' && <p className="muted">Choose an account first.</p>}
        {problem && <p className="warn" role="alert">{problem}</p>}
        {csv && filename && <p className="mny-filename">{mode === 'file' ? 'Chosen file' : 'Pasted'}: <strong>{filename}</strong> ({csv.rows.length} row{csv.rows.length === 1 ? '' : 's'})</p>}
        <p className="muted">
          Re-importing the same or an overlapping file is safe: rows already imported are skipped, and rows that match something you
          entered by hand mark it cleared instead of creating a duplicate. Nothing is written until you confirm.
        </p>
        {message && <div className="ok" role="status">{message}</div>}
        {message && importedIds.length > 0 && <MatchesNotice txnIds={importedIds} />}
      </section>

      {csv && map && (
        <>
          <section className="card" aria-labelledby="imp-map">
            <h2 id="imp-map" className="mny-h2 mny-h2--tight">2. Match the columns</h2>
            {layoutState.kind === 'saved' && !editing && (
              <>
                <p role="status"><strong>Using your saved layout</strong> for {account?.name}.</p>
                <ul className="mny-saved" aria-label="Saved column layout">
                  <li>Date: <strong>{map.date}</strong>{' '}({map.dateOrder === 'MDY' ? 'month/day/year' : 'day/month/year'})</li>
                  <li>Description: <strong>{map.description}</strong></li>
                  {map.amount && <li>Amount: <strong>{map.amount}</strong></li>}
                  {map.debit && <li>Money out: <strong>{map.debit}</strong></li>}
                  {map.credit && <li>Money in: <strong>{map.credit}</strong></li>}
                  {map.externalId && <li>Bank transaction ID: <strong>{map.externalId}</strong></li>}
                  {map.invertSign && <li>Signs are flipped.</li>}
                </ul>
                <button type="button" onClick={() => setEditing(true)}>Change mapping</button>
              </>
            )}
            {layoutState.kind === 'mismatch' && <p className="warn" role="status">Your saved layout for {account?.name} does not fit this file. {layoutState.reason} Please check the columns below.</p>}
            {(editing || layoutState.kind !== 'saved') && (<>
            {layoutState.kind === 'saved' && <p className="muted">You are changing your saved layout. The new choices are remembered after you import.</p>}
            {layoutState.kind !== 'saved' && <p className="muted">After you import, Ledger remembers these columns for {account?.name ?? 'this account'}. Nothing is remembered until then.</p>}
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
            </>)}
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
                <button className="link danger" aria-label={`Undo import of ${b.filename}`} onClick={() => setAskUndo(b.id!)}>undo</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {undoRow && (
        <ConfirmDialog
          title="Undo import?"
          confirmLabel="Undo import"
          busyLabel="Undoing…"
          kind="linked"
          onCancel={() => setAskUndo(null)}
          onConfirm={async () => {
            // The same safeguard as deleting a transaction: if Ledger cannot tell what depends on these transactions, nothing is undone; if what depends on them changed since the list was shown, it is shown again.
            if (undoPlan === null) return 'Ledger is still checking what depends on these transactions. Try again in a moment. Nothing was undone.';
            if (undoPlan === 'failed' || !undoPlan.verified) return 'Ledger could not finish checking what depends on these transactions, so nothing was undone. Close this and try again.';
            const now = await planUndo(undoRow.id!);
            if (!now.verified) return 'Ledger could not finish checking what depends on these transactions, so nothing was undone. Close this and try again.';
            if (now.fingerprint !== undoPlan.fingerprint) { setUndoPlan(now); return 'Something changed since you looked. The list above is updated. Check it, then press Undo import again. Nothing was undone.'; }
            await undoBatch(db, undoRow.id!);
            setAskUndo(null);
          }}
        >
          <p><strong>{undoRow.filename}</strong><br /><span className="muted small">{accounts.find((a) => a.id === undoRow.accountId)?.name} · {new Date(undoRow.importedAt).toLocaleString()}</span></p>
          <p>This deletes the {undoRow.createdCount} transaction{undoRow.createdCount === 1 ? '' : 's'} this import added{undoRow.matched.length ? ` and puts the ${undoRow.matched.length} entr${undoRow.matched.length === 1 ? 'y' : 'ies'} it matched back to how ${undoRow.matched.length === 1 ? 'it' : 'they'} were before` : ''}. Changes you made to the imported transactions since are lost with them.</p>
          {undoPlan && undoPlan !== 'failed' && undoPlan.verified && undoPlan.dependents.length > 0 && (() => {
            const words = deletionWords(undoPlan, 'selection');
            const seen = new Set<string>();
            const records = undoPlan.dependents.filter((x) => { const k = `${x.module}|${x.recordId}`; if (seen.has(k)) return false; seen.add(k); return true; });
            return (
              <div className="banner warn" role="note" data-testid="undo-impact">
                <div>
                  <p style={{ margin: 0 }}><strong>{words.headline}</strong></p>
                  {words.consequence && <p style={{ margin: '4px 0 0' }}>{words.consequence}</p>}
                  {words.spending && <p style={{ margin: '4px 0 0' }}>{words.spending}</p>}
                  <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }} aria-label="Records that use these transactions">
                    {records.slice(0, 8).map((x) => <li key={`${x.module}|${x.recordId}`}>{x.href ? <a href={`#${x.href}`} onClick={() => setAskUndo(null)}>{x.title}</a> : x.title}<span className="muted"> · {x.moduleLabel}</span></li>)}
                    {records.length > 8 && <li className="muted">…and {records.length - 8} more.</li>}
                  </ul>
                </div>
              </div>
            );
          })()}
          {undoPlan && undoPlan !== 'failed' && !undoPlan.verified && <div className="banner bad" role="alert">Ledger could not finish checking what depends on these transactions, so Undo is off. Close this and try again.</div>}
          {undoPlan === 'failed' && <div className="banner bad" role="alert">Ledger could not check what depends on these transactions, so Undo is off. Close this and try again.</div>}
        </ConfirmDialog>
      )}
    </div>
  );
}
