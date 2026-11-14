import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allModules } from '../core/registry';
import { registerModules } from '../modules';
import { LEDGER_ROUTE_PATHS } from '../modules/ledger/routePaths';
import { BASELINE } from './uiBaseline';

/**
 * D5. The coverage guard for docs/UI-COVERAGE.md. It does NOT parse the app's source in general. It uses the registrations the app already keeps
 * (the module registry and the Ledger route list), plus a short EXPLICIT inventory for the modules whose routes are written as JSX, and a tripwire
 * that fails when a route is declared anywhere else. So a page cannot be added without the tracker hearing about it, and the guard states what it cannot see.
 *
 * What it cannot see: query-string states (?new=1, ?add=member), views inside a page, dialogs opened from a page, and a route declared by some new
 * mechanism that does not use the <Route> element. Those are tracked by hand (sections 3 and 4 of the tracker) and are covered by review.
 */

const tracker = readFileSync('docs/UI-COVERAGE.md', 'utf8');

// ---------- the tracker's rows ----------

interface Row { id: string; cells: string[] }
const rows: Row[] = tracker.split('\n').flatMap((line) => {
  const m = line.match(/^\| ((?:[A-Z]{1,2}|IV|DL|CF)-\d{2,3}) \|(.*)\|\s*$/);
  return m ? [{ id: m[1], cells: m[2].split('|').map((c) => c.trim()) }] : [];
});
const byPrefix = (re: RegExp) => rows.filter((r) => re.test(r.id));
const PAGE_ID = /^[TCKPAVBHFNGL]-\d{2}$/;
const pages = byPrefix(PAGE_ID);
const surfaces = byPrefix(/^S-\d{2}$/);
const views = byPrefix(/^IV-\d{2}$/);
const workflows = byPrefix(/^W-\d{2}$/);
const dialogs = byPrefix(/^DL-\d{2}$/);
const confirms = byPrefix(/^CF-\d{2}$/);

const ticks = (cells: string[]) => cells.slice(-6); // L, D, 375, 1440, Kbd, Func
const code = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('D5 the tracker is well formed', () => {
  it('has the inventory totals that D4 counted (checked against the source, see the report)', () => {
    expect(pages).toHaveLength(59);
    expect(surfaces).toHaveLength(23);
    expect(views).toHaveLength(31);
    expect(workflows).toHaveLength(37);
    expect(dialogs).toHaveLength(10);
    expect(confirms).toHaveLength(3);
  });

  it('every ID is unique', () => {
    const ids = rows.map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('page IDs run without gaps within each prefix', () => {
    for (const p of new Set(pages.map((r) => r.id.split('-')[0]))) {
      const nums = pages.filter((r) => r.id.startsWith(`${p}-`)).map((r) => Number(r.id.split('-')[1]));
      expect(nums, p).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it('every page, surface, view and workflow row has a phase (D5 to D21), a valid status and valid acceptance marks', () => {
    for (const r of [...pages, ...surfaces, ...views, ...workflows]) {
      const phase = r.cells.find((c) => /^D\d+(, D\d+)*$|^all$/.test(c));
      expect(phase, `${r.id} has no phase`).toBeTruthy();
      for (const d of (phase ?? '').match(/D\d+/g) ?? []) expect(Number(d.slice(1)), `${r.id} phase ${d}`).toBeGreaterThanOrEqual(5);
      expect(r.cells.some((c) => ['NS', 'INH', 'BLT', 'CMT', 'DEP', 'ACC'].includes(c)), `${r.id} has no status`).toBe(true);
      if (!r.id.startsWith('W-')) {
        const t = ticks(r.cells);
        expect(t, r.id).toHaveLength(6);
        for (const x of t) expect(['Y', '.'], `${r.id} mark "${x}"`).toContain(x);
        // ACC needs every acceptance mark; a row cannot claim acceptance with a mark missing.
        if (r.cells.includes('ACC')) expect(t.every((x) => x === 'Y'), `${r.id} is ACC without all marks`).toBe(true);
      }
    }
  });

  it('every file the tracker names exists', () => {
    const missing: string[] = [];
    for (const r of [...pages, ...surfaces]) for (const c of r.cells) for (const f of code(c)) if (f.startsWith('src/') && !existsSync(f)) missing.push(`${r.id}: ${f}`);
    expect(missing).toEqual([]);
  });

  it('in-page views point at a real page row', () => {
    const pageIds = new Set(pages.map((p) => p.id));
    for (const v of views) expect(pageIds.has(v.cells[0].split(' ')[0]), `${v.id} -> ${v.cells[0]}`).toBe(true);
  });

  it('a row is not accepted before it has been built: after D10 only twelve global surfaces and the five Quick Add workflows are beyond NS, and they are BLT (built, not accepted)', () => {
    const beyond = [...pages, ...surfaces, ...views, ...workflows, ...dialogs, ...confirms].filter((r) => r.cells.some((c) => ['INH', 'BLT', 'CMT', 'DEP', 'ACC'].includes(c)));
    // D6 restyled the shared layer: the Add button colour (S-04), Modal and ConfirmDialog (S-08), Toast (S-09), PageHeader, EmptyState and Banner (S-21) and the chart
    // surface and series (S-23). No routed page, view, workflow or dialog call site changed, and nothing may read ACC until all six marks are recorded.
    // D7 restyled the global header (S-01), the module switcher list (S-02) and the sync chip (S-03); S-04 was already listed. S-12 (skip link) only has Kbd and Func marks and stays NS.
    // D8 replaced the desktop sidebar by the Ledger bar (S-13), moved the page top bar and breadcrumbs under it (S-14) and relocated the theme toggle (S-17). The phone's section
    // tabs (S-15) and bottom tab bar (S-16) were not visually modified and stay NS; no Ledger page row changed.
    // D10 redesigned the Add box (S-05) and, with it, the five Quick Add workflows W-01 to W-05 were built and run. DL-01 stays NS (Search and the confirmation dialog are untouched).
    // D12 redesigned Ledger Home (L-01), Family overview (F-01) and Household Finances (H-01, with its review workflow W-37); the shared charts (S-23) gained marks. Family detail pages, Contacts and every other module page are untouched.
    // Add an ID here only in the change that builds it.
    // D14 redesigned Projects (P-01, P-02), Home & Assets (A-01 to A-03) and Contacts (N-01, N-02) with their tab views (IV-15 to IV-23) and the three workflows W-31, W-32 and W-36; DL-04 to DL-06 and IV-31 are untouched.
    // D15 redesigned Household Services (V-01 to V-04), Bills & Subscriptions (B-01 to B-05; B-04 in the final Bills refinement) and the Family member and dates pages (F-02, F-03) with the workflows W-33, W-34 and W-35; DL-07 to DL-09 are untouched.
    // D16 redesigned the nine core Money pages (L-02 to L-07, L-10 to L-12) and built W-14 to W-19; DL-10 (the Ledger dialog call sites) is untouched.
    // D18 redesigned the ten Financial Planning pages (L-17 to L-26), their in-page views IV-27 and IV-28, and built W-21, W-22 and W-23.
    // D17 redesigned the six analysis, Invest and debt pages (L-08, L-09, L-13 to L-16), their in-page views IV-24 to IV-26, IV-29 and IV-30, and built W-20, W-24 and W-25.
    // D19 redesigned More, Year in review, the guide, Tax package, the Settings frame and its five pages (L-27 to L-31, G-01 to G-05), built W-26 to W-30 and the print styles (S-19).
    // D13 redesigned the Calendar page (C-01 and its four views), the event editor and day dialog (DL-03) and the layer menu and event workflows (W-09, W-10); W-11 and the other Calendar dialogs are untouched.
    // D21 set the browser-bar colour before first paint (S-20, built, not accepted; the default appearance and the manifest are unchanged).
    // D20 restyled the shared Modal and ConfirmDialog (S-08), added the page-error state to the module loader states (S-11) and marked the shared confirmation (CF-01); no dialog group (DL-xx) changed status, and CF-03 stays NS (OD-6 is open).
    expect(beyond.map((r) => r.id).sort()).toEqual([...['F-01', 'H-01', 'IV-05', 'IV-06', 'IV-07', 'IV-08', 'IV-09', 'IV-10', 'IV-11', 'IV-12', 'IV-13', 'IV-14', 'K-01', 'L-01', 'S-01', 'S-02', 'S-03', 'S-04', 'S-05', 'S-08', 'S-09', 'S-11', 'CF-01', 'CF-03', 'S-13', 'S-14', 'S-17', 'S-21', 'S-23', 'T-01', 'W-01', 'W-02', 'W-03', 'W-04', 'W-05', 'W-12', 'W-13', 'W-37', 'V-01', 'V-02', 'V-03', 'V-04', 'B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'F-02', 'F-03', 'W-33', 'W-34', 'W-35'], 'C-01', 'DL-03', 'IV-01', 'IV-02', 'IV-03', 'IV-04', 'W-09', 'W-10', 'P-01', 'P-02', 'A-01', 'A-02', 'A-03', 'N-01', 'N-02', 'IV-15', 'IV-16', 'IV-17', 'IV-18', 'IV-19', 'IV-20', 'IV-21', 'IV-22', 'IV-23', 'W-31', 'W-32', 'W-36', 'L-02', 'L-03', 'L-04', 'L-05', 'L-06', 'L-07', 'L-10', 'L-11', 'L-12', 'W-14', 'W-15', 'W-16', 'W-17', 'W-18', 'W-19', 'L-08', 'L-09', 'L-13', 'L-14', 'L-15', 'L-16', 'IV-24', 'IV-25', 'IV-26', 'IV-29', 'IV-30', 'W-20', 'W-24', 'W-25', 'L-17', 'L-18', 'L-19', 'L-20', 'L-21', 'L-22', 'L-23', 'L-24', 'L-25', 'L-26', 'IV-27', 'IV-28', 'W-21', 'W-22', 'W-23', 'L-27', 'L-28', 'L-29', 'L-30', 'L-31', 'G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'W-26', 'W-27', 'W-28', 'W-29', 'W-30', 'S-19', 'S-20'].sort());
    for (const r of beyond) expect(r.cells.includes('BLT'), `${r.id} is built, not accepted`).toBe(true);
  });
});

describe('D5 dialogs and confirmations are accounted for', () => {
  it('the dialog rows add up to the recorded <Modal> count, which equals the source baseline', () => {
    const sum = dialogs.reduce((n, r) => n + Number(r.cells[1]), 0);
    expect(sum).toBe(63);
    expect(sum).toBe(BASELINE.modalSites);
    expect(tracker).toMatch(/\| \| \*\*Total\*\* \| \*\*63\*\* \| 42 files/);
    expect(BASELINE.modalFiles).toBe(42);
  });
  it('every dialog row names a module and a phase, and the three confirmation styles are listed with the native count', () => {
    for (const d of dialogs) expect(d.cells.some((c) => /^D\d+/.test(c)), d.id).toBe(true);
    expect(confirms.map((c) => c.id)).toEqual(['CF-01', 'CF-02', 'CF-03']);
    expect(confirms[2].cells.join(' ')).toContain(`${BASELINE.nativeConfirm} in ${BASELINE.nativeConfirmFiles} files`);
  });
});

// ---------- the app's routes ----------

/** Modules whose pages are declared with <Route> elements, and the addresses (after the module's own prefix) they declare. Update with the tracker when a page is added. */
const JSX_ROUTES: Record<string, { file: string; paths: string[] }> = {
  assets: { file: 'src/modules/assets/AssetsModule.tsx', paths: ['', 'list', ':id'] },
  bills: { file: 'src/modules/bills/BillsModule.tsx', paths: ['', 'list', 'upcoming', 'review', 'o/:id'] },
  contacts: { file: 'src/modules/contacts/ContactsModule.tsx', paths: ['', 'c/:id'] },
  family: { file: 'src/modules/family/FamilyModule.tsx', paths: ['', 'm/:id', 'dates'] },
  household: { file: 'src/modules/household/HouseholdModule.tsx', paths: [''] },
  projects: { file: 'src/modules/projects/ProjectsModule.tsx', paths: ['', ':id'] },
  services: { file: 'src/modules/services/ServicesModule.tsx', paths: ['', 'a/:id', 'providers/:contactId', 'v/:id'] },
  settings: { file: 'src/pages/SettingsPage.tsx', paths: ['general', 'appearance', 'backup', 'sync', 'calendar'] },
};
/** Modules that are one screen with no sub-addresses. */
const SINGLE_SCREEN = ['today', 'calendar', 'tasks'];

/** The <Route> lines of a file, reduced to their path ('' for index), without the catch-all and without Navigate redirects. */
function routesIn(file: string): string[] {
  const out: string[] = [];
  for (const m of readFileSync(file, 'utf8').matchAll(/<Route\s+(index|path="([^"]*)")\s+element=\{([^}]*)\}/g)) {
    const path = m[1] === 'index' ? '' : m[2];
    if (path === '*' || /^<Navigate\b/.test(m[3].trim())) continue;
    out.push(path);
  }
  return out;
}

const trackerAddresses = pages.map((r) => code(r.cells[0])[0]);
const expectedAddresses = [
  ...Object.entries(JSX_ROUTES).flatMap(([mod, v]) => v.paths.map((p) => `/${mod}${p ? `/${p}` : ''}`)),
  ...SINGLE_SCREEN.map((m) => `/${m}`),
  ...LEDGER_ROUTE_PATHS.filter((p) => p !== '/backup').map((p) => (p === '/' ? '/ledger' : `/ledger${p}`)),
];

describe('D5 every registered route is in the tracker', () => {
  it('each module with <Route> elements declares exactly the addresses this guard lists (so a new page is noticed)', () => {
    for (const [mod, v] of Object.entries(JSX_ROUTES)) expect(routesIn(v.file).sort(), `${mod}: ${v.file}`).toEqual([...v.paths].sort());
  });

  it('no other source file declares routes (tripwire for a new module or a new route mechanism)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const withRoutes = walk('src').filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f) && /<Route[\s>]/.test(readFileSync(f, 'utf8')));
    const known = [...Object.values(JSX_ROUTES).map((v) => v.file), 'src/App.tsx', 'src/modules/ledger/LedgerModule.tsx'];
    expect(withRoutes.sort()).toEqual([...new Set(known)].sort());
  });

  it('every registered module is represented, and the single-screen modules really have no sub-routes', () => {
    registerModules();
    const ids = allModules().map((m) => m.id).sort();
    expect(ids).toEqual(['assets', 'bills', 'calendar', 'contacts', 'family', 'household', 'ledger', 'projects', 'services', 'tasks', 'today']);
    for (const id of ids) expect(trackerAddresses.some((a) => a === `/${id}` || a.startsWith(`/${id}/`)), `no tracker row for module ${id}`).toBe(true);
    for (const m of SINGLE_SCREEN) expect(trackerAddresses.filter((a) => a.startsWith(`/${m}`)), m).toEqual([`/${m}`]);
  });

  it('every Ledger address in LEDGER_ROUTE_PATHS is in the tracker (the redirect to Settings is not a page)', () => {
    for (const p of LEDGER_ROUTE_PATHS.filter((x) => x !== '/backup')) {
      const a = p === '/' ? '/ledger' : `/ledger${p}`;
      expect(trackerAddresses, a).toContain(a);
    }
    expect(LEDGER_ROUTE_PATHS).toHaveLength(32); // 32 entries = 31 pages + the /backup redirect (D4)
    expect(trackerAddresses.filter((a) => a.startsWith('/ledger'))).toHaveLength(31);
  });

  it('the tracker lists exactly the addresses the app registers: none missing, none invented, none twice', () => {
    expect([...trackerAddresses].sort()).toEqual([...expectedAddresses].sort());
    expect(new Set(trackerAddresses).size).toBe(trackerAddresses.length);
    expect(expectedAddresses).toHaveLength(59);
  });

  it('the Settings tab row and the redirect are documented, and /ledger/backup stays a redirect', () => {
    expect(readFileSync('src/modules/ledger/LedgerModule.tsx', 'utf8')).toMatch(/\['\/backup', <Navigate to="\/settings\/backup" replace \/>\]/);
    expect(tracker).toContain('`/ledger/backup` redirects to `/settings/backup`');
  });
});
