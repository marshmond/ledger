import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { loadProjectChoices, type ProjectChoice } from '../lib/txnProject';
import { asksAboutRefund, impliedLine, pickableContracts, splitContract, type TagState } from '../lib/txnProjectTag';

/** The projects (with lines and contracts) a form can offer. Refreshes by itself when a project changes. */
export const useProjectChoices = (): ProjectChoice[] => useLiveQuery(() => loadProjectChoices(db), []) ?? [];

interface Props {
  value: TagState;
  onChange: (t: TagState) => void;
  choices: ProjectChoice[];
  /** Whether the amount comes back to you (money in). */
  moneyIn: boolean;
  /** A split row: project, contract and line, but no "general refund or contract" question. */
  compact?: boolean;
  label?: string;
}

/**
 * The Project box on a transaction: project, then (only that project's) budget line and contract. The choices are hierarchical; picking
 * a contract that already has a budget line uses that line. Money coming back on a contract has to say whether it is a reversal or a credit.
 */
export default function ProjectTag({ value, onChange, choices, moneyIn, compact, label = 'Project' }: Props) {
  const set = (p: Partial<TagState>) => onChange({ ...value, ...p });
  const project = choices.find((p) => String(p.id) === value.projectId);
  // Offer open projects; an archived one only if it is already chosen.
  const offered = choices.filter((p) => !p.archived || String(p.id) === value.projectId);
  const contracts = pickableContracts(project, value.commitmentId);
  const implied = impliedLine(project, value.commitmentId);
  const isSplit = splitContract(project, value.commitmentId) && !(moneyIn && !compact && asksAboutRefund(project, value) && value.refundKind !== 'contract');
  const asks = !compact && moneyIn && asksAboutRefund(project, value);
  const showContract = !!project && contracts.length > 0 && !(asks && value.refundKind !== 'contract');
  const missing = !!value.projectId && !project;

  return (
    <div className="ptag">
      <div className="row ptag-row">
        <label className="f">{label}
          <select
            value={value.projectId}
            onChange={(e) => onChange({ projectId: e.target.value, lineId: '', commitmentId: '', effect: '', refundKind: '' })}
          >
            <option value="">No project</option>
            {missing && <option value={value.projectId}>(project no longer exists)</option>}
            {offered.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
          </select>
        </label>

        {project && asks && (
          <fieldset className="ptag-ask">
            <legend>Is this money about a contract?</legend>
            <label className="chk"><input type="radio" name={`rk-${label}`} checked={value.refundKind === 'project'} onChange={() => set({ refundKind: 'project', commitmentId: '', effect: '' })} />No, a general refund or reimbursement for the project</label>
            <label className="chk"><input type="radio" name={`rk-${label}`} checked={value.refundKind === 'contract'} onChange={() => set({ refundKind: 'contract' })} />Yes, money back on a contract</label>
          </fieldset>
        )}

        {project && showContract && (
          <label className="f">Contract
            <select
              value={value.commitmentId}
              onChange={(e) => set({ commitmentId: e.target.value, effect: e.target.value ? value.effect : '', lineId: impliedLine(project, e.target.value)?.id === Number(value.lineId) ? '' : value.lineId, lineUnsure: false })}
            >
              <option value="">{asks ? 'Choose the contract…' : 'No contract'}</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== 'accepted' ? ` (${c.status})` : ''}</option>)}
            </select>
          </label>
        )}

        {project && isSplit && (
          <label className="f">Which line is this for?
            <select
              value={value.lineUnsure ? 'unsure' : value.lineId}
              onChange={(e) => (e.target.value === 'unsure' ? set({ lineId: '', lineUnsure: true }) : set({ lineId: e.target.value, lineUnsure: false }))}
              aria-describedby={`ptag-split-${label}`}
            >
              <option value="">Choose a line…</option>
              {project.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="unsure">Not sure yet</option>
            </select>
          </label>
        )}

        {project && !isSplit && project.lines.length > 0 && (
          <label className="f">Budget line
            <select value={value.lineId === String(implied?.id) ? '' : value.lineId} onChange={(e) => set({ lineId: e.target.value })} aria-describedby={implied ? `ptag-implied-${label}` : undefined}>
              <option value="">{implied ? `Same as the contract (${implied.name})` : 'No budget line'}</option>
              {project.lines.filter((l) => l.id !== implied?.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {isSplit && <p className="muted small" id={`ptag-split-${label}`}>This agreement is split across budget lines. It counts as one payment on the agreement; the line says which part of the plan it is for. "Not sure yet" keeps it in "No budget line" until you choose.</p>}
      {implied && <p className="muted small" id={`ptag-implied-${label}`}>The contract is filed under {implied.name}. Pick another line to count this part there instead; it still counts against the contract.</p>}

      {project && value.commitmentId && moneyIn && (
        <fieldset className="ptag-ask">
          <legend>What is this money?</legend>
          <label className="chk"><input type="radio" name={`ef-${label}`} checked={value.effect === 'reversal'} onChange={() => set({ effect: 'reversal' })} /><span><strong>Reversal</strong>: a payment that was undone. What you paid goes down and the contract is owed again.</span></label>
          <label className="chk"><input type="radio" name={`ef-${label}`} checked={value.effect === 'credit'} onChange={() => set({ effect: 'credit' })} /><span><strong>Credit</strong>: the price came down. What you paid goes down, and the agreed amount should come down by the same, with a negative change order in the project (you will be offered one).</span></label>
        </fieldset>
      )}
      {project && !value.commitmentId && moneyIn && value.refundKind === 'project' && (
        <p className="muted small">Counted as money back for the project, lowering what it has cost.</p>
      )}
    </div>
  );
}
