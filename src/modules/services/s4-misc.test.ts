import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { createAsset, setAssetStatus } from '../assets/data';
import { blankAsset } from '../assets/model';
import { applyMoveToReplacement, planMoveToReplacement } from './assetLinks';
import { createArrangement, getArrangement, updateArrangement } from './data';
import { blankArrangement } from './model';
import { serviceRecords } from './records';
import { searchServicesData } from './searchSource';
import { loadArrangements } from './data';
import { loadVisits, logStandaloneVisit } from './visits';
import { handoffEligibility } from './handoff';
import { duplicateGroups } from './visitModel';
import { attentionLines } from './todayCards';
import { attentionCounts, loadSnapshot } from './views';

let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4m-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';

describe('S4 privacy and small safeguards', () => {
  it('33. Search never matches or shows contract dates, notes, links, amounts or contact details', async () => {
    const d = fresh();
    await createArrangement({
      data: blankArrangement({ title: 'Lawn care', notes: 'gate code 4455', refs: [{ label: 'Agreement', url: 'https://example.com/secret-contract' }], expected: { basis: 'perMonth', cents: 12345 }, renewalDate: '2027-04-01', noticeByDate: '2027-03-01' }),
      provider: { name: 'Pat Lawns', phone: '555-0100', email: 'pat@example.com' }, today: TODAY,
    }, d);
    const arrangements = await loadArrangements(d);
    for (const q of ['2027-04-01', '2027-03-01', 'gate', '4455', 'secret-contract', '12345', '555-0100', 'pat@example.com', 'renewal', 'notice']) {
      expect(searchServicesData(q, arrangements).filter((r) => r.kind === 'Service')).toEqual([]);
    }
    const hit = searchServicesData('lawn', arrangements).filter((r) => r.kind === 'Service');
    expect(hit).toHaveLength(1);
    expect(JSON.stringify(hit)).not.toMatch(/2027|4455|secret|12345|555-0100|pat@example/);
    expect(JSON.stringify(await serviceRecords.describe(`arrangement:${arrangements[0].id}`))).not.toMatch(/2027|4455|secret|12345|555-0100|pat@example/);
  });
  it('a Move to replacement refreshes the arrangement\'s updated time, so an edit form opened earlier (which would quietly re-link the old asset) is refused', async () => {
    const d = fresh();
    const oldA = await createAsset(blankAsset({ name: 'Old furnace', type: 'system' }), d), newA = await createAsset(blankAsset({ name: 'New furnace', type: 'system' }), d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Plan' }), provider: { name: 'Pat' }, assetIds: [oldA], today: TODAY }, d);
    await setAssetStatus(oldA, { status: 'replaced', statusDate: '2026-10-01', statusNote: '', replacedById: newA }, d);
    const opened = (await getArrangement(r.id, d))!.updatedAt;
    await new Promise((x) => setTimeout(x, 5));
    await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, oldA, d)).expect! }, d);
    await expect(updateArrangement(r.id, { title: 'Plan', startDate: null, extraContactIds: [], expected: null, refs: [], notes: 'late edit', assetIds: [oldA] }, opened, d)).rejects.toThrow(/was changed/);
  });
  it('Today and the eligibility check read the same visit outcome words: skipped and cancelled never qualify, unsupported never qualifies', async () => {
    const d = fresh();
    const mk = async (status: 'completed' | 'skipped' | 'cancelled') => (await logStandaloneVisit({ provider: { name: 'Pat' }, input: { status, cancelledBy: status === 'cancelled' ? 'provider' : null, date: '2026-11-03', title: `V ${status}`, chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
    await mk('completed'); await mk('skipped'); await mk('cancelled');
    const visits = await loadVisits(d);
    expect(Object.fromEntries(visits.map((v) => [v.data.status, handoffEligibility(v).ok]))).toEqual({ completed: true, skipped: false, cancelled: false });
    expect(handoffEligibility({ ...visits[0], data: { ...visits[0].data, status: 'unsupported' } }).ok).toBe(false);
    expect(duplicateGroups(visits)).toEqual([]);
    expect(attentionLines(attentionCounts(await loadSnapshot(d), TODAY))).toEqual([]);
  });
});
