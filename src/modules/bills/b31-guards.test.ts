import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';

/**
 * B3.1 source guards. The existing Bills guards (guards.test.ts, b3-spend.test.ts) are unchanged and still run over every new file. These add the
 * promises that are specific to discovery, suggestions and the Finance Scheduled link: the one read-only Finance loader, pure readers, who may write
 * which record, and no new table, dependency, network call or timer.
 */
const DIR = 'src/modules/bills';
const sources = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'billsTestkit.ts').map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));
const scan = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.f).sort();
const text = (f: string) => sources.find((s) => s.f === f)!.text;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('B3.1 guards: Finance is read through ONE read-only loader', () => {
  const loader = readFileSync('src/lib/financeRead.ts', 'utf8');

  it('the loader has no write call, no posting, no forecast, no import and no network, only reads', () => {
    const c = code(loader);
    expect(/\.(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify|upsert)\s*\(/.test(c)).toBe(false);
    expect(/\btransaction\s*\(/.test(c)).toBe(false);
    expect(/postInstance|skipInstance|deleteRule|createTransfer|applyRulesToExisting|forecast|csvImport|loanLedger|fetch\(|localStorage/.test(c)).toBe(false);
    expect([...c.matchAll(/\.(toArray|bulkGet|where|between|get|count)\b/g)].length).toBeGreaterThan(0);
  });

  it('it re-exports exactly three pure helpers and nothing that writes', () => {
    const exp = [...loader.matchAll(/^export \{([^}]*)\} from '([^']+)'/gm)].map((m) => `${m[1].trim()} <- ${m[2]}`).sort();
    expect(exp).toEqual(['detectRecurring, normPayee <- ./rules'.replace('detectRecurring, normPayee', 'normPayee, detectRecurring'), 'occurrencesBetween <- ./schedule'].sort());
    expect([...loader.matchAll(/^export (async )?function (\w+)/gm)].map((m) => m[2]).sort()).toEqual(['loadAllTxns', 'loadScheduled', 'loadTxnsBetween']);
  });

  it('only these Bills files import it, and no Bills file opens a Finance table of its own (the earlier guards still hold)', () => {
    expect(scan(/lib\/financeRead'/)).toEqual(['discovery.ts', 'discoveryData.ts', 'dueProvider.ts', 'payeeMatch.ts', 'scheduledLink.ts', 'scheduledLinkData.ts', 'suggest.ts', 'suggestData.ts']);
    expect(scan(/\.(txns|recurring|recurringLog|loans)\b/)).toEqual([]);
  });
});

describe('B3.1 guards: the readers are pure', () => {
  const PURE = ['discovery.ts', 'suggest.ts', 'scheduledLink.ts', 'payeeMatch.ts', 'formSeed.ts'];
  it('no database, store, React, clock, storage or network in a reader', () => {
    for (const f of PURE) {
      const c = code(text(f));
      expect(/from '\.\.\/\.\.\/db'|from '\.\.\/\.\.\/core\/store'|from 'react'|moduleRecords|repo\(|Date\.now|new Date|localStorage|sessionStorage|fetch\(|setTimeout|setInterval|Math\.random/.test(c), f).toBe(false);
    }
  });

  it('a reader never imports a writer of its own module', () => {
    for (const f of PURE) expect(/from '\.\/(cycleData|data|discoveryData|scheduledLinkData|suggestData|tasks|cycleRepair|contractData)'/.test(text(f)), f).toBe(false);
  });
});

describe('B3.1 guards: who may write what', () => {
  it('review-choice records are written only in discoveryData.ts', () => {
    expect(scan(/kind:\s*DISCOVERY_KIND/)).toEqual(['discoveryData.ts']);
    expect(scan(/kind:\s*'discovery'/)).toEqual([]);
  });

  it('the rejection fact is written only in cycleData.ts (the existing one-file rule for cycle records), and by no screen', () => {
    expect(scan(/kind:\s*CYCLE_KIND/).filter((f) => !['cycleData.ts', 'cycleRepair.ts'].includes(f))).toEqual([]);
    expect(scan(/\brejectSuggestion\b|\breconsiderRejection\b/)).toEqual(['PeriodsCard.tsx', 'SuggestionsUI.tsx', 'cycleData.ts']);
  });

  it('a bill\'s Scheduled pointer is changed only by the link writers (and the creation that the owner confirmed)', () => {
    expect(scan(/applyEdit\([^)]*scheduledRuleIds/)).toEqual(['scheduledLinkData.ts']);
    expect(scan(/scheduledRuleIds:\s*input\.ruleId/)).toEqual(['discoveryData.ts']);
  });

  it('no screen writes a Finance Scheduled rule: nothing in Bills posts, skips, edits or deletes one', () => {
    expect(scan(/postInstance|skipInstance|deleteRule|\.recurringLog|\.recurring\b/)).toEqual([]);
  });

  it('rejecting, reconsidering and recording a choice make no Task: Tasks are made only by tasks.ts, and neither the rejection nor the decision writer calls it', () => {
    const rej = text('cycleData.ts');
    const start = rej.indexOf('export function rejectSuggestion');
    const end = rej.indexOf('// ---- the preview of a new record ----');
    const body = rej.slice(start, end);
    expect(/ensureBillTasksIn|createTask|saveTask|completeTask|removeTasks|finishTaskIn/.test(code(body))).toBe(false);
    expect(/ensureBillTasksIn|createTask|saveTask|completeTask|removeTasks/.test(code(text('discoveryData.ts').replace('createObligation', '')))).toBe(false);
  });
});

describe('B3.1 guards: no schema, no dependency, no network, no timer', () => {
  it('the schema is still Dexie version 15 with 40 tables (no table, no migration)', () => {
    const d = new FinanceDB('b31-schema');
    expect(d.verno).toBe(15);
    expect(d.tables).toHaveLength(40);
  });

  it('the dependencies are exactly the ones B3 shipped with', () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(p.dependencies).toEqual({ dexie: '^4.4.6', 'dexie-react-hooks': '^4.4.0', papaparse: '^5.7.0', react: '^19.3.0', 'react-dom': '^19.3.0', 'react-router-dom': '^7.18.4' });
    expect(Object.keys(p.devDependencies).sort()).toEqual(['@types/papaparse', '@types/react', '@types/react-dom', '@vitejs/plugin-react', 'fake-indexeddb', 'typescript', 'vite', 'vitest']);
  });

  it('no network call and no persistent timer anywhere in the new Bills files or the loader', () => {
    const files = ['discovery.ts', 'suggest.ts', 'scheduledLink.ts', 'payeeMatch.ts', 'formSeed.ts', 'discoveryData.ts', 'suggestData.ts', 'scheduledLinkData.ts', 'SuggestionsUI.tsx', 'ScheduledUI.tsx', 'DiscoverCard.tsx'];
    for (const f of files) expect(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|setInterval)\b|localStorage|sessionStorage|indexedDB/.test(code(text(f))), f).toBe(false);
    expect(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|setInterval)\b|localStorage/.test(code(readFileSync('src/lib/financeRead.ts', 'utf8')))).toBe(false);
  });

  it('no AI, model or ranking library is imported by the readers (ranking is plain, ordered rules)', () => {
    for (const f of ['discovery.ts', 'suggest.ts', 'payeeMatch.ts']) expect(/anthropic|openai|tensorflow|ml-|natural|fuse\.js|string-similarity/.test(text(f)), f).toBe(false);
  });

  it('no suggestion or discovery screen shows a percentage or a "confidence" figure', () => {
    for (const f of ['SuggestionsUI.tsx', 'DiscoverCard.tsx', 'ScheduledUI.tsx', 'suggest.ts', 'discovery.ts']) expect(/confidence|\d\s*%|percent/i.test(code(text(f)).replace(/\*\s*0\.\d+|0\.\d+\s*\*/g, '')), f).toBe(false);
  });

  it('no settlement or automatic-payment claim is made in the new words', () => {
    for (const f of ['SuggestionsUI.tsx', 'DiscoverCard.tsx', 'ScheduledUI.tsx', 'suggest.ts', 'scheduledLink.ts']) expect(/\bsettled\b|bank-confirmed|automatically (paid|linked|created)|was paid by|has been paid/i.test(text(f)), f).toBe(false);
  });
});
