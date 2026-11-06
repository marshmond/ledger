import { useState } from 'react';
import { db } from '../db';
import type { Txn } from '../types';
import { formatCents } from '../lib/money';
import { bulkSetTxnProject, type BulkProjectResult, type BulkSkipReason } from '../lib/txnProject';
import { useToast } from '../ui/Toast';
import { useProjectChoices } from './ProjectTag';

const WHY: Record<BulkSkipReason, string> = {
  transfer: 'A transfer or setup entry is not project spending.',
  split: 'A split transaction. Open it and tag the split that belongs to the project.',
  alreadyTagged: 'Already on a different project or line. Tick "Replace tags" to change it.',
  needsChoice: 'Money coming back on a contract. Open it and say whether it is a reversal or a credit.',
  ambiguousRefund: 'Money coming back, and this project has contracts. Open it to say if it belongs to one, or tick the general refund box.',
  exceedsPayments: 'More than was paid on that contract, so it cannot be money coming back.',
};

/** Sets or clears the project on the selected transactions, and says exactly what was changed and what was left alone, and why. */
export default function BulkProject({ ids, txns, onDone }: { ids: number[]; txns: Txn[]; onDone: () => void }) {
  const toast = useToast();
  const projects = useProjectChoices().filter((p) => !p.archived);
  const [projectId, setProjectId] = useState('');
  const [lineId, setLineId] = useState('');
  const [contractId, setContractId] = useState('');
  const [replace, setReplace] = useState(false);
  const [generalRefunds, setGeneralRefunds] = useState(false);
  const [result, setResult] = useState<BulkProjectResult | null>(null);
  const [error, setError] = useState('');

  const project = projects.find((p) => String(p.id) === projectId);
  const contracts = (project?.contracts ?? []).filter((c) => c.status === 'accepted');
  const contract = contracts.find((c) => String(c.id) === contractId);
  const picked = txns.filter((t) => ids.includes(t.id!));
  const anyIn = picked.some((t) => t.amountCents > 0 && !t.transferTxnId);
  const hasContracts = contracts.length > 0;

  async function run(clear: boolean) {
    setError('');
    try {
      const r = await bulkSetTxnProject(
        db, ids,
        clear ? null : {
          projectId: Number(projectId),
          ...(contract ? { commitmentId: contract.id } : lineId ? { budgetLineId: Number(lineId) } : {}),
        },
        { replace, refundsAreProjectLevel: generalRefunds },
      );
      setResult(r);
      const skipped = r.skipped?.length ?? 0;
      toast(clear ? `Removed the project from ${r.updated} transaction${r.updated === 1 ? '' : 's'}.` : `Tagged ${r.updated} transaction${r.updated === 1 ? '' : 's'}${skipped ? `, left ${skipped} alone` : ''}.`);
      if (!skipped) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the project.');
    }
  }

  if (projects.length === 0) return null;
  const byId = new Map(txns.map((t) => [t.id, t]));
  const reasons = (result?.skipped ?? []).reduce((m, s) => m.set(s.reason, [...(m.get(s.reason) ?? []), s.txnId]), new Map<BulkSkipReason, number[]>());

  return (
    <div className="bulk-project">
      <div className="row">
        <strong>Project</strong>
        <select aria-label="Set project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setLineId(''); setContractId(''); setResult(null); }}>
          <option value="">Choose a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {project && hasContracts && (
          <select aria-label="Contract" value={contractId} onChange={(e) => { setContractId(e.target.value); setLineId(''); }}>
            <option value="">No contract</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        {project && !contract && project.lines.length > 0 && (
          <select aria-label="Budget line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">No budget line</option>
            {project.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <button disabled={!projectId} onClick={() => void run(false)}>Apply project</button>
        <button className="link" onClick={() => { if (confirm(`Remove the project tag from ${ids.length} selected transaction(s)? Tags on individual splits stay.`)) void run(true); }}>Remove project</button>
      </div>
      <div className="row small">
        <label className="chk"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace tags that are already there</label>
        {project && hasContracts && anyIn && !contract && (
          <label className="chk"><input type="checkbox" checked={generalRefunds} onChange={(e) => setGeneralRefunds(e.target.checked)} />Money coming back is a general refund for the project, not a contract</label>
        )}
      </div>
      {contract && anyIn && <p className="muted small">Money coming back cannot be put on a contract in bulk. Those are left alone, so you can open each and choose reversal or credit.</p>}
      {error && <div className="error" role="alert">{error}</div>}
      {result && (
        <div className="bulk-result" role="status">
          <strong>{result.updated} updated{result.skipped?.length ? `, ${result.skipped.length} left alone` : ''}.</strong>
          {[...reasons].map(([reason, list]) => (
            <details key={reason} open>
              <summary>{list.length} · {WHY[reason]}</summary>
              <ul className="plain">
                {list.slice(0, 20).map((id) => { const t = byId.get(id); return <li key={id} className="small">{t ? `${t.date} · ${t.payee || '(no payee)'} · ${formatCents(t.amountCents)}` : `Transaction ${id}`}</li>; })}
                {list.length > 20 && <li className="muted small">…and {list.length - 20} more</li>}
              </ul>
            </details>
          ))}
          <button className="link" onClick={() => { setResult(null); onDone(); }}>Close</button>
        </div>
      )}
    </div>
  );
}
