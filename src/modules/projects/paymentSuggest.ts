/**
 * R2.2 "Possible matches" for Projects: which PROJECT a Finance payment may be spending on, judged by the project's own vendors.
 *
 *  - A Project does not store a link: the transaction carries the project tag itself (`Txn.project`), so "Accept" means setting that one tag through Projects' existing
 *    `setTxnProject`, built with the same `buildRef` the transaction form uses. Nothing else on the transaction is touched (not its amount, payee, account, date, status
 *    or splits), and nothing about the project (budget, commitments, change orders, allocations) is edited. Money out only.
 *  - Identity is a VENDOR of the project: the payee must match the name of one of the project's vendor Contacts (the same word-based comparison Bills uses, `lib/payeeMatch`)
 *    and the project must still be open for spending (planning or active). When the project has start and target dates the payment must fall between 30 days before the
 *    start and 90 days after the target. Amount alone is never enough, and the vendor name alone is not enough to ACCEPT: it must be backed by project dates or an agreed contract with that vendor (otherwise Review).
 *  - A payment is never assumed to belong WHOLLY to one project. A split transaction is always a REVIEW (the transaction editor, where each part can be tagged), and so is a vendor
 *    with more than one agreed contract, or one whose contract is split across budget lines: the owner chooses the contract and line in the existing form.
 *  - ACCEPT with no contract tags the project only; with exactly one plain agreed contract it tags that contract too (the line that contract implies), exactly as choosing it in the form would.
 *  - REJECT is the shared per-pair memory (`core/paymentSuggestions`).
 */
import type { FinanceDB } from '../../db';
import { isRejected, liveContactNames, loadRejections, saveRejection } from '../../core/paymentSuggestions';
import type { LinkCandidate, LinkResult, PaymentSuggestionContext, RawCandidate } from '../../core/paymentSuggestions';
import { addDays } from '../../lib/dates';
import { payeeMatch } from '../../lib/payeeMatch';
import { loadProjectChoices, setTxnProject, type ProjectChoice } from '../../lib/txnProject';
import { buildRef, EMPTY_TAG } from '../../lib/txnProjectTag';
import { isSpendingTxn } from '../../lib/txnRef';
import type { ProjectRef } from '../../types';
import { loadProjects } from './data';

const MODULE_ID = 'projects';
const MAX_PER_TXN = 3;
const OPEN_FOR_SPENDING = new Set(['planning', 'active']);

interface Payload { projectId: number; ref: ProjectRef | null }

/** The reference the transaction form would build for this vendor on this project, or why the owner has to choose. */
function refFor(choice: ProjectChoice, vendorContactId: number): { ref: ProjectRef } | { choose: string } {
  const contracts = choice.contracts.filter((c) => c.status === 'accepted' && c.vendorContactId === vendorContactId);
  if (contracts.length === 0) return { ref: { projectId: choice.id } };
  if (contracts.length > 1) return { choose: 'This vendor has more than one agreed contract on the project. Choose which one this payment is for.' };
  const c = contracts[0];
  if (c.split) return { choose: 'This vendor’s contract is split across budget lines. Choose which line this payment is for.' };
  const built = buildRef({ ...EMPTY_TAG, projectId: String(choice.id), commitmentId: String(c.id) }, [choice], false);
  return built.ref ? { ref: built.ref } : { choose: built.error ?? 'Choose the contract in the transaction editor.' };
}

export async function suggest({ txns, d }: PaymentSuggestionContext): Promise<RawCandidate[]> {
  const [projects, choices, rejected] = await Promise.all([loadProjects(d), loadProjectChoices(d), loadRejections(d, MODULE_ID)]);
  const open = projects.filter((p) => !p.data.archived && OPEN_FOR_SPENDING.has(p.data.status) && p.data.vendorContactIds.length > 0);
  if (open.length === 0) return [];
  const names = await liveContactNames(d, open.flatMap((p) => p.data.vendorContactIds));
  const out: RawCandidate[] = [];
  for (const t of txns) {
    if (t.amountCents >= 0 || !isSpendingTxn(t) || t.project) continue;
    const split = (t.splits?.length ?? 0) > 0;
    const found: RawCandidate[] = [];
    for (const p of open) {
      const { startDate, targetDate } = p.data;
      if (startDate && t.date < addDays(startDate, -30)) continue;
      if (targetDate && t.date > addDays(targetDate, 90)) continue;
      const vendorId = p.data.vendorContactIds.find((id) => names.has(id) && payeeMatch(t.payee, [{ text: names.get(id)!, via: 'provider' }]).kind === 'exact');
      if (vendorId === undefined) continue;
      const targetKey = `project:${p.id}`;
      if (isRejected(rejected, t, targetKey)) continue;
      const choice = choices.find((c) => c.id === p.id);
      if (!choice) continue;
      const built = refFor(choice, vendorId);
      const reasons = [`The payee matches ${names.get(vendorId)}, a vendor on this project.`];
      if (startDate || targetDate) reasons.push('The payment is dated within the project’s dates.');
      if ('ref' in built && built.ref.commitmentId !== undefined) reasons.push('This vendor has one agreed contract on the project, so the payment would count against it.');
      // one signal is not enough to tag a whole payment: the vendor name must be backed by the project's dates or by this vendor's agreed contract
      const backed = !!(startDate || targetDate) || ('ref' in built && built.ref.commitmentId !== undefined);
      const note = split ? 'This payment is split into parts. Tag each part in the transaction editor; Ledger does not assume the whole payment is for one project.' : 'choose' in built ? built.choose : !backed ? 'Only the vendor’s name points at this project (it has no dates and no agreed contract with this vendor), so it needs your look first.' : null;
      found.push({
        txnId: t.id!, targetKey, targetKind: 'Project', targetTitle: p.data.name, targetDetail: p.data.status === 'active' ? 'Active project' : 'Planning',
        href: `/projects/${p.id}`, reasons, action: note === null ? 'accept' : 'review', reviewNote: note, reviewHref: `/ledger/transactions?txn=${t.id}`,
        payload: { projectId: p.id, ref: 'ref' in built ? built.ref : null } satisfies Payload,
      });
    }
    out.push(...found.slice(0, MAX_PER_TXN));
  }
  return out;
}

/** Tags the payment with Projects' own `setTxnProject` (after re-reading it), which itself checks the project and the contract still exist and belong together. */
export async function accept(c: LinkCandidate, d: FinanceDB, _today?: string): Promise<LinkResult> {
  const p = c.payload as Payload;
  if (!p.ref) return { ok: false, message: 'This one needs your choice of contract first. Open it. Nothing was linked.' };
  const t = await d.txns.get(c.txnId);
  if (!t) return { ok: false, message: 'That payment is no longer in Finance, so nothing was linked.' };
  if (t.project || (t.splits?.length ?? 0) > 0) return { ok: false, message: 'That payment was tagged or split since Ledger looked, so nothing was linked.' };
  if (t.amountCents >= 0 || !isSpendingTxn(t)) return { ok: false, message: 'That is no longer a payment that can be project spending, so nothing was linked.' };
  const project = (await loadProjects(d)).find((x) => x.id === p.projectId);
  if (!project || project.data.archived || !OPEN_FOR_SPENDING.has(project.data.status)) return { ok: false, message: 'That project is no longer open for spending, so nothing was linked.' };
  await setTxnProject(d, c.txnId, p.ref);
  return { ok: true, message: `Tagged as spending on “${project.data.name}”. Only the project tag was added; the payment itself is unchanged.` };
}

export async function reject(c: LinkCandidate, d: FinanceDB): Promise<() => Promise<void>> {
  const t = await d.txns.get(c.txnId);
  if (!t) throw new Error('That payment is no longer in Finance.');
  return saveRejection(d, MODULE_ID, t, c.targetKey);
}
