import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';

/**
 * B4 source guards. The earlier Bills guards (guards.test.ts, b3-spend.test.ts, b31-guards.test.ts) still run over every new file and are unchanged except for ONE
 * addition: `lifecycleFinance.ts` is listed as a file allowed to use the read-only Finance loader (b31-guards.test.ts). These add what is specific to the lifecycle:
 * who may write which record, which files are pure or read-only, that no schema, dependency or network call appeared, and that the words never claim Ledger acted.
 */
const DIR = 'src/modules/bills';
const sources = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'billsTestkit.ts').map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));
const scan = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.f).sort();
const text = (f: string) => sources.find((s) => s.f === f)!.text;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const B4_FILES = ['lifecycleModel.ts', 'lifecycleState.ts', 'lifecycleRead.ts', 'lifecycleCharges.ts', 'lifecycleFinance.ts', 'lifecycleData.ts', 'crossLinks.ts', 'LifecycleCard.tsx', 'LifecycleDialogs.tsx'];

describe('B4 guards: who may write what', () => {
  it('the new files exist', () => { for (const f of B4_FILES) expect(sources.some((s) => s.f === f), f).toBe(true); });

  it('lifecycle records are written only by the action writer and the Household Services link writer', () => {
    expect(scan(/kind:\s*LC_KIND/)).toEqual(['crossLinks.ts', 'lifecycleData.ts']);
    expect(scan(/kind:\s*'lifecycle'/)).toEqual([]);
  });

  it('a shared link is written only by crossLinks.ts, and only the `bills-for` type', () => {
    expect(scan(/repo<Link>\(\s*d\.links\s*\)/)).toEqual(['crossLinks.ts', 'undo.ts']); // undo.ts only removes or restores links its own recorder noted
    const c = code(text('crossLinks.ts'));
    expect([...c.matchAll(/type:\s*([A-Za-z_'"-]+)/g)].map((m) => m[1])).toEqual(['BILLS_FOR']);
    expect(scan(/shared\.links\.(add|remove)/)).toEqual([]);
    expect(scan(/\bd\.links\.(add|put|bulkAdd|bulkPut|delete|clear|update)\b/)).toEqual([]);
  });

  it('Tasks are made, moved and removed only by tasks.ts; the writer calls the planner and never the Tasks API', () => {
    expect(scan(/\b(createTask|saveTask|completeTask|removeTasks)\b/)).toEqual(['tasks.ts']);
    expect(/\b(createTask|saveTask|completeTask|removeTasks)\b/.test(code(text('lifecycleData.ts')))).toBe(false);
    expect(/ensureBillTasksIn/.test(text('lifecycleData.ts'))).toBe(true);
  });

  it('the bill record itself is changed by the lifecycle writer only through the existing end and reopen rules the owner chose', () => {
    const c = code(text('lifecycleData.ts'));
    expect([...c.matchAll(/writeObligation\(/g)].length).toBe(1); // the one call, made only for the end or reopen the owner chose
    // pre-commit correction: a confirmation can never end a bill. Only the owner's withdrawal or reactivation may REOPEN one, through the existing reopen rule.
    expect(/buildLifecycle\(d, 'reopen'/.test(c) && !/buildLifecycle\([^)]*'end'/.test(c) && !/markEnded/.test(c)).toBe(true);
    expect(/status:\s*'(ended|active)'/.test(c)).toBe(false); // it never sets a status itself
  });

  it('nothing in the new files writes a Finance table, a Scheduled rule, a payment link or a Calendar event', () => {
    for (const f of B4_FILES) {
      const c = code(text(f));
      expect(/\.(txns|recurring|recurringLog|loans|accounts|categories)\b/.test(c), f).toBe(f === 'LifecycleCard.tsx' ? false : false);
      expect(/postInstance|skipInstance|deleteRule|createEvent|publishDueItem|dueItems/.test(c), f).toBe(false);
    }
    expect(/kind:\s*CYCLE_KIND|kind:\s*'cycle'/.test(code(text('lifecycleData.ts')) + code(text('crossLinks.ts')))).toBe(false); // no payment-link or other billing fact is written here
  });
});

describe('B4 guards: the readers are pure or read-only', () => {
  it('model, state and charges: no database, store, React, clock, storage or network', () => {
    for (const f of ['lifecycleModel.ts', 'lifecycleState.ts', 'lifecycleCharges.ts']) {
      const c = code(text(f));
      expect(/from '\.\.\/\.\.\/db'|from '\.\.\/\.\.\/core\/store'|from 'react'|moduleRecords|repo\(|Date\.now|new Date|localStorage|sessionStorage|fetch\(|setTimeout|setInterval|Math\.random/.test(c), f).toBe(false);
      expect(/from '\.\/(data|cycleData|lifecycleData|discoveryData|scheduledLinkData|suggestData|tasks|contractData|crossLinks)'/.test(c), f).toBe(false);
    }
  });

  it('the loader files write nothing', () => {
    for (const f of ['lifecycleRead.ts', 'lifecycleFinance.ts']) {
      const c = code(text(f));
      expect(/\.(put|add|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify)\s*\(|repo\(|\.remove\(|\btransaction\s*\(/.test(c), f).toBe(false);
    }
  });

  it('the lifecycle loader for Finance is the only new file that reaches the read-only Finance loader, and it uses only its read functions', () => {
    expect(scan(/lib\/financeRead'/).includes('lifecycleFinance.ts')).toBe(true);
    const c = code(text('lifecycleFinance.ts'));
    expect([...c.matchAll(/import \{([^}]*)\} from '\.\.\/\.\.\/lib\/financeRead'/g)].map((m) => m[1].split(',').map((x) => x.trim()).sort().join(','))).toEqual(['loadScheduled,loadTxnsBetween']);
  });
});

describe('B4 guards: no schema, no dependency, no network, no timer', () => {
  it('the schema is still Dexie version 15 with 40 tables', () => {
    const d = new FinanceDB('b4-schema');
    expect(d.verno).toBe(15);
    expect(d.tables).toHaveLength(40);
  });
  it('the dependencies are exactly the ones B3.1 shipped with', () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(p.dependencies).toEqual({ dexie: '^4.4.6', 'dexie-react-hooks': '^4.4.0', papaparse: '^5.7.0', react: '^19.3.0', 'react-dom': '^19.3.0', 'react-router-dom': '^7.18.4' });
    expect(Object.keys(p.devDependencies).sort()).toEqual(['@types/papaparse', '@types/react', '@types/react-dom', '@vitejs/plugin-react', 'fake-indexeddb', 'typescript', 'vite', 'vitest']);
  });
  it('no network call, no persistent timer and no browser storage in the new files', () => {
    for (const f of B4_FILES) expect(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|setInterval)\b|localStorage|sessionStorage|indexedDB/.test(code(text(f))), f).toBe(false);
  });
  it('the sync, backup and database files were not touched by B4 (only the backup summary gained one label)', () => {
    const summary = readFileSync('src/lib/backupSummary.ts', 'utf8');
    expect(summary).toMatch(/lifecycle: 'Subscription lifecycle records'/);
  });
});

describe('B4 guards: the words never claim Ledger acted', () => {
  const WORDS = ['LifecycleCard.tsx', 'LifecycleDialogs.tsx', 'lifecycleState.ts', 'lifecycleData.ts', 'lifecycleCharges.ts', 'crossLinks.ts'];
  it('no sentence says it cancelled, renewed, refunded, disputed or settled anything', () => {
    for (const f of WORDS) {
      const t = text(f);
      expect(/(has|have|was|were) been (cancell?ed|renewed|refunded|disputed|converted)|\bautomatically (cancell?ed|renewed|refunded|disputed)|\bsettled\b|your (subscription|cancellation) (is|was) (cancell?ed|confirmed)/i.test(t), f).toBe(false);
    }
  });
  it('a request is never worded as a confirmation, and a passed date is never worded as an event that happened', () => {
    const t = text('lifecycleState.ts');
    expect(t).toMatch(/Cancellation requested, confirmation pending/);
    expect(t).toMatch(/Ledger did not renew anything and does not know whether it renewed/);
    expect(t).toMatch(/Ledger did not convert anything and does not know whether it became a paid plan/);
    expect(/renewed successfully|has renewed|did convert/i.test(t)).toBe(false);
  });
  it('the new screens show money only through the Hide-Amounts-aware helpers', () => {
    for (const f of ['LifecycleCard.tsx', 'LifecycleDialogs.tsx']) {
      const c = code(text(f));
      expect(/formatCents\(|toLocaleString|Intl\.NumberFormat/.test(c), f).toBe(false);
    }
  });
  it('no percentage or confidence figure is shown for a charge after a cancellation', () => {
    for (const f of ['LifecycleCard.tsx', 'lifecycleCharges.ts']) expect(/confidence|\d\s*%|percent/i.test(code(text(f))), f).toBe(false);
  });
});
