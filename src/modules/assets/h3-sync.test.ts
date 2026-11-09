import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { assetsOfProject, linkProjectToAsset, projectsOfAsset, unlinkProjectFromAsset } from '../../core/projectAssetLink';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createProject, getProject } from '../projects/data';
import { deleteProjectPermanently } from '../projects/deletion';
import { blankProject } from '../projects/model';
import { createAsset, getAsset, loadAssets, updateAsset } from './data';
import { deleteAssetPermanently } from './deletion';
import { blankAsset } from './model';
import { blankService } from './service';
import { createService, getService, loadServices, updateService } from './serviceData';
import { assetSpend, costRecords } from './spending';
import { loadTxnMap, lookupOfMap } from './txnLookup';
import { makeTxnRef } from './txnRef';
import type { Txn } from '../../types';

/** Real SyncEngine and mergeSnapshots with two devices (same set-up as service-sync.test.ts). Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h3-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const svc = (assetId: number, over = {}) => blankService(assetId, { title: 'Replaced pump', date: '2026-11-01', kind: 'repair', ...over });

function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
const devices = () => {
  const remote = remoteStore();
  const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`h3-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mkd(), B: mkd() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));
const spendOn = async (d: FinanceDB, id: number) => {
  const [assets, services] = await Promise.all([loadAssets(d), loadServices(d)]);
  return assetSpend(assets, services, id, lookupOfMap(await loadTxnMap(costRecords(assets, services).flatMap((r) => r.refs), d))).own;
};

async function seeded() {
  const { A, B } = devices();
  const t = (await A.d.txns.add({ accountId: 1, date: '2026-03-02', amountCents: -45000, payee: 'Hardware Co', memo: '', status: 'cleared', categoryId: 5 } as Txn)) as number;
  const x = await createAsset(blankAsset({ name: 'Furnace', type: 'appliance' }), A.d);
  const house = await createAsset(blankAsset({ name: 'House', type: 'property' }), A.d);
  const p = await createProject(blankProject({ name: 'Basement remodel' }), A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, t, x, house, p };
}

describe('H3 references and project links across two devices (real sync engine and merge)', () => {
  it('a. references and snapshots reach the other device and resolve to the same spending', async () => {
    const { A, B, t, x } = await seeded();
    const ref = makeTxnRef((await A.d.txns.get(t))!);
    await updateAsset(x, { ...(await getAsset(x, A.d))!.data, purchaseTxnRefs: [ref] }, A.d);
    const s = await createService(svc(x, { txnRefs: [ref] }), A.d, TODAY);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(x, d))!.data.purchaseTxnRefs).toEqual([ref]);
      expect((await getService(s, d))!.data.txnRefs).toEqual([ref]);
      expect((await spendOn(d, x)).totalCents).toBe(45000);
    });
  });

  it('b. a transaction deleted on one device leaves the history intact and flags the reference on both', async () => {
    const { A, B, t, x } = await seeded();
    const s = await createService(svc(x, { txnRefs: [makeTxnRef((await A.d.txns.get(t))!)] }), A.d, TODAY);
    await settle(A, B);
    await sleep(15);
    await A.d.txns.delete(t);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await getService(s, d)).toBeDefined();
      const r = await spendOn(d, x);
      expect(r.totalCents).toBe(0);
      expect(r.review).toHaveLength(1);
    });
  });

  it('c. a project link made on one device appears on the other, and removing it keeps both records everywhere', async () => {
    const { A, B, house, p } = await seeded();
    await linkProjectToAsset(p, house, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect((await projectsOfAsset(house, d)).map((l) => l.projectId)).toEqual([p]); });
    await sleep(15);
    await unlinkProjectFromAsset(p, house, B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await projectsOfAsset(house, d)).toEqual([]);
      expect(await getAsset(house, d)).toBeDefined();
      expect(await getProject(p, d)).toBeDefined();
    });
  });

  it('d. a project deleted for good on one device unlinks everywhere and leaves the asset', async () => {
    const { A, B, house, p } = await seeded();
    await linkProjectToAsset(p, house, A.d);
    await settle(A, B);
    await deleteProjectPermanently(p, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeUndefined();
      expect(await assetsOfProject(p, d)).toEqual([]);
      expect(await getAsset(house, d)).toBeDefined();
    });
  });

  it('e. concurrent edits to the asset on one device and a service record on the other both survive', async () => {
    const { A, B, t, x } = await seeded();
    const s = await createService(svc(x), A.d, TODAY);
    await settle(A, B);
    await sleep(15);
    await updateAsset(x, { ...(await getAsset(x, A.d))!.data, name: 'Furnace (basement)' }, A.d);
    await updateService(s, { ...(await getService(s, B.d))!.data, txnRefs: [makeTxnRef((await B.d.txns.get(t))!)] }, B.d, TODAY);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(x, d))!.data.name).toBe('Furnace (basement)');
      expect((await getService(s, d))!.data.txnRefs).toHaveLength(1);
      expect((await spendOn(d, x)).totalCents).toBe(45000);
    });
  });

  it('f. a permanent deletion on one device (which removes its project link) does not destroy history made on a stale device, and the project survives', async () => {
    const { A, B, x, p } = await seeded();
    await linkProjectToAsset(p, x, A.d);
    await settle(A, B);
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    const sid = await createService(svc(x, { costCents: 100 }), B.d, TODAY);
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await everywhere([A, B], async (d) => {
      expect(await getAsset(x, d)).toBeDefined();
      expect(await getService(sid, d)).toBeDefined();
      expect(await getProject(p, d)).toBeDefined();
    });
  });
});
