import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { PendingView, lazyModule, preloadLazyModule } from '../core/lazyModule';
import { all, parseHtml } from '../lib/a11yTestkit';
import ConfirmDialog, { CONFIRM_KIND_LABEL } from './ConfirmDialog';
import Modal from './Modal';
import { ModuleLoadBoundary, ModuleLoadFailed, ModuleLoading, PageErrorBoundary, PageProblem, SAFE_PLACE_HREF } from './ModuleLoader';
import { makeConfirmRunner } from './confirmRun';
import { attachModal, guardedClose, type BoxLike, type DocLike, type FocusableLike, type KeyEventLike } from './modalKeys';
import { attachSheet, lockScroll, scrollLocksHeld, type BackdropLike, type LockTarget, type WindowLike } from './sheetBehavior';

/**
 * D20. Dialogs, confirmations and error recovery. The test environment has no browser DOM, so these tests use the same three techniques as the rest of the suite:
 * static markup (what a dialog says and is named), small stand-ins for the page (keys, focus, the visible area) and plain functions (the confirmation runner), plus
 * the boundaries' own methods (what they do when React hands them an error). Real keyboard, focus and phone behaviour is checked separately in a browser and listed in the D20 report.
 * Everything below is invented; nothing reads or writes real data.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const txt = (s: string) => s.replace(/<[^>]+>/g, '');
const modal = (props: Record<string, unknown>, kids: unknown = 'x') => createElement(Modal, { onClose: () => undefined, ...props, children: kids } as never);
const setProps = (o: object, props: object) => { (o as { props: unknown }).props = props; };

// ---------------------------------------------------------------- stand-ins
function page() {
  const handlers: ((e: KeyEventLike) => void)[] = [];
  const modals: BoxLike[] = [];
  const doc: DocLike & { activeElement: unknown } = {
    activeElement: null,
    addEventListener: (_t, fn) => { handlers.push(fn); },
    removeEventListener: (_t, fn) => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); },
    querySelectorAll: () => modals,
  };
  const el = (over: Partial<FocusableLike> = {}): FocusableLike => ({ focus() { doc.activeElement = this; }, getClientRects: () => [1], ...over });
  const box = (items: FocusableLike[]): BoxLike => {
    const b: BoxLike = { focus() { doc.activeElement = b; }, getClientRects: () => [1], contains: (x) => x === b || items.includes(x as FocusableLike), querySelectorAll: () => items };
    modals.push(b);
    return b;
  };
  const press = (key: string, shiftKey = false) => {
    const e = { key, shiftKey, stop: false, prevented: false, stopPropagation() { this.stop = true; }, preventDefault() { this.prevented = true; } };
    for (const h of [...handlers]) h(e);
    return e;
  };
  return { doc, el, box, press, handlers };
}

function sheetEnv(visibleHeight: number) {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  const frames: Array<() => void> = [];
  let queried = 0;
  const el: BackdropLike = {
    style: { setProperty: (n, v) => { props.set(n, v); }, removeProperty: (n) => props.delete(n) },
    setAttribute: (n, v) => { attrs.set(n, v); },
    removeAttribute: (n) => { attrs.delete(n); },
  };
  const vv = { height: visibleHeight, offsetTop: 0, addEventListener: () => undefined, removeEventListener: () => undefined };
  const win: WindowLike = {
    innerHeight: 812,
    visualViewport: vv,
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => { frames.length = 0; },
    matchMedia: () => { queried++; return { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }; },
  };
  const doc: LockTarget = { documentElement: { style: { overflow: '', overscrollBehavior: '' } }, body: { style: { overflow: '' } } };
  return { props, attrs, el, win, doc, queried: () => queried };
}

// ---------------------------------------------------------------- 1. the shared Modal
describe('D20 shared Modal: structure, names and sizes (existing callers unchanged)', () => {
  it('a Modal with no new props draws exactly what it drew before: a named dialog, the title, a Close button and the content', () => {
    const out = html(modal({ title: 'Edit asset' }, createElement('p', null, 'inside')));
    const dlg = all(parseHtml(out), (e) => e.attrs.role === 'dialog')[0];
    expect(dlg.attrs['aria-modal']).toBe('true');
    expect(dlg.attrs['aria-label']).toBe('Edit asset');
    expect(dlg.attrs['aria-describedby']).toBeUndefined();
    expect(dlg.attrs['aria-busy']).toBeUndefined();
    expect(dlg.attrs.class).toBe('modal '); // no size, no extra class: byte-for-byte the previous class text
    expect(out).toContain('aria-label="Close"');
    expect(out).not.toContain('disabled');
    expect(txt(out)).toContain('inside');
  });

  it('wide is still wide; size "lg" is the same; size "sm" is the small question width; "md" is the default', () => {
    const cls = (p: Record<string, unknown>) => all(parseHtml(html(modal({ title: 'T', ...p }))), (e) => e.attrs.role === 'dialog')[0].attrs.class;
    expect(cls({ wide: true })).toBe('modal wide');
    expect(cls({ size: 'lg' })).toBe('modal wide');
    expect(cls({ size: 'sm' })).toBe('modal  modal--sm');
    expect(cls({ size: 'md' })).toBe('modal ');
    expect(cls({ variant: 'sheet', className: 'ab-modal' })).toBe('modal  modal--sheet ab-modal');
  });

  it('a description is attached to the dialog (aria-describedby points at its paragraph)', () => {
    const out = html(modal({ title: 'Move transaction', description: 'This changes two balances.' }));
    const root = parseHtml(out);
    const dlg = all(root, (e) => e.attrs.role === 'dialog')[0];
    const id = dlg.attrs['aria-describedby'];
    expect(id).toBeTruthy();
    const para = all(root, (e) => e.attrs.id === id)[0];
    expect(para.tag).toBe('p');
    expect(txt(out)).toContain('This changes two balances.');
  });

  it('a locked dialog says it is busy and cannot be closed with the button', () => {
    const out = html(modal({ title: 'Saving', locked: true }));
    const root = parseHtml(out);
    expect(all(root, (e) => e.attrs.role === 'dialog')[0].attrs['aria-busy']).toBe('true');
    const close = all(root, (e) => e.attrs['aria-label'] === 'Close')[0];
    expect('disabled' in close.attrs).toBe(true);
  });
});

describe('D20 Escape, backdrop and close button: the lock', () => {
  it('guardedClose closes when not locked and does nothing while locked, reading the lock at the moment of use', () => {
    let locked = false;
    const close = vi.fn();
    const g = guardedClose(() => locked, close);
    g();
    expect(close).toHaveBeenCalledTimes(1);
    locked = true;
    g(); g();
    expect(close).toHaveBeenCalledTimes(1);
    locked = false;
    g();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('Escape closes an ordinary dialog and is not passed on; while locked Escape is still taken (the page behind never hears it) but nothing closes', () => {
    const p = page();
    let locked = false;
    const close = vi.fn();
    const a = p.el();
    attachModal(p.doc, p.box([a]), guardedClose(() => locked, close));
    expect(p.press('Escape').stop).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    locked = true;
    expect(p.press('Escape').stop).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a long form (40 controls): Tab wraps at both ends, Escape closes, and focus goes back to the control that opened it', () => {
    const p = page();
    const opener = p.el();
    opener.focus();
    const items = Array.from({ length: 40 }, () => p.el());
    const close = vi.fn();
    const detach = attachModal(p.doc, p.box(items), close, opener);
    expect(p.doc.activeElement).not.toBe(opener); // focus moved into the dialog
    items[39].focus();
    expect(p.press('Tab').prevented).toBe(true);
    expect(p.doc.activeElement).toBe(items[0]);
    expect(p.press('Tab', true).prevented).toBe(true);
    expect(p.doc.activeElement).toBe(items[39]);
    items[20].focus();
    expect(p.press('Tab').prevented).toBe(false); // the middle is left to the browser
    p.press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    detach();
    expect(p.doc.activeElement).toBe(opener);
    expect(p.handlers).toHaveLength(0); // nothing left listening
  });
});

// ---------------------------------------------------------------- 2. phone sheet, reduced visible area
describe('D20 the visible area (on-screen keyboard) and the page scroll lock', () => {
  it('with the keyboard up (only 400 of 812 px visible) the backdrop is trimmed to the visible area and marked, and it is put back on close', () => {
    const t = sheetEnv(400);
    const detach = attachSheet(t.el, t.win, t.doc, { lock: false });
    expect(t.props.get('--sheet-top')).toBe('0px');
    expect(t.props.get('--sheet-bottom')).toBe('412px');
    expect(t.attrs.get('data-keyboard')).toBe('open');
    detach();
    expect(t.props.size).toBe(0);
    expect(t.attrs.size).toBe(0);
  });

  it('an ordinary dialog (lock: false) follows the keyboard but never locks the page behind it or asks the window about touch', () => {
    const t = sheetEnv(400);
    const before = scrollLocksHeld();
    const detach = attachSheet(t.el, t.win, t.doc, { lock: false });
    expect(scrollLocksHeld()).toBe(before);
    expect(t.doc.body.style.overflow).toBe('');
    expect(t.queried()).toBe(0);
    detach();
  });

  it('a sheet (the default) still locks the page on a phone and lets go on close, exactly as in D10', () => {
    const t = sheetEnv(812);
    const before = scrollLocksHeld();
    const detach = attachSheet(t.el, t.win, t.doc);
    expect(scrollLocksHeld()).toBe(before + 1);
    expect(t.doc.body.style.overflow).toBe('hidden');
    detach();
    expect(scrollLocksHeld()).toBe(before);
    expect(t.doc.body.style.overflow).toBe('');
    // the lock itself is counted, so two sheets cannot release each other
    const a = lockScroll(t.doc), b = lockScroll(t.doc);
    a();
    expect(t.doc.body.style.overflow).toBe('hidden');
    b();
    expect(t.doc.body.style.overflow).toBe('');
  });

  it('every dialog asks for the visible-height behaviour; only a sheet asks for the lock (source)', () => {
    expect(read('src/shell/Modal.tsx')).toMatch(/useSheetBehavior\(back, true, variant === 'sheet'\)/);
  });
});

// ---------------------------------------------------------------- 3. ConfirmDialog
describe('D20 ConfirmDialog: structure and safeguards', () => {
  const draw = (props: Record<string, unknown> = {}) => html(createElement(ConfirmDialog, { title: 'Delete account "Test Checking"?', confirmLabel: 'Delete account', onConfirm: () => undefined, onCancel: () => undefined, ...props } as never, createElement('p', null, 'This removes it.')));

  it('Cancel comes before the action in reading order, the action names itself, and the dialog is the small width', () => {
    const out = draw();
    const root = parseHtml(out);
    const buttons = all(root, (e) => e.tag === 'button' && e.attrs.type === 'button' && !e.attrs['aria-label']);
    expect(buttons.map((b) => txt(html(createElement('div', null)) + (b.children[0] as string))).slice(0, 2)).toEqual(['Cancel', 'Delete account']);
    expect(all(root, (e) => e.attrs.role === 'dialog')[0].attrs.class).toContain('modal--sm');
    expect(all(root, (e) => e.attrs.role === 'dialog')[0].attrs.class).toContain('modal--danger');
  });

  it('a destructive (danger) confirmation gets the danger look; a primary one does not', () => {
    expect(draw()).toContain('class="danger"');
    expect(draw({ tone: 'primary' })).toContain('class="primary"');
    expect(draw({ tone: 'primary' })).not.toContain('modal--danger');
  });

  it('a kind adds a labelled line (words, not colour alone); with no kind there is no such line and the wording of the caller is untouched', () => {
    expect(draw()).not.toContain('ui-confirm-kind');
    for (const k of ['linked', 'irreversible', 'replace'] as const) {
      const out = draw({ kind: k });
      expect(out).toContain('ui-confirm-kind');
      expect(txt(out)).toContain(CONFIRM_KIND_LABEL[k]);
      expect(txt(out)).toContain('This removes it.');
    }
    expect(draw({ kind: 'replace' })).toContain('modal--replace');
  });

  it('the dialog renders no error until one is raised, and the error element is an announced alert', () => {
    expect(draw()).not.toContain('role="alert"');
    const src = read('src/shell/ConfirmDialog.tsx');
    expect(src).toMatch(/className="error ui-dialog-error" role="alert"/);
    expect(src).toMatch(/runner\.current\?\.go\(\)/);
  });

  it('while the action runs the dialog is locked (Escape, a click outside and Close do nothing) and focus starts on Cancel (source)', () => {
    const src = read('src/shell/ConfirmDialog.tsx');
    expect(src).toMatch(/locked=\{busy\}/);
    expect(src).toMatch(/cancel\.current\?\.focus\(\)/);
    expect(src).toMatch(/onClose=\{\(\) => \{ if \(!runner\.current\?\.running\) onCancel\(\); \}\}/);
  });
});

describe('D20 the confirmation runner: asynchronous, no duplicate action, errors keep the dialog open', () => {
  function hooks() {
    const log: string[] = [];
    return { log, setBusy: (b: boolean) => log.push(`busy:${b}`), setError: (m: string | null) => log.push(`error:${m}`) };
  }

  it('a second press while the first is running does nothing: the action runs once', async () => {
    const h = hooks();
    let release!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const run = makeConfirmRunner(() => onConfirm, h);
    const first = run.go();
    expect(run.running).toBe(true);
    await run.go();
    await run.go();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(run.running).toBe(false);
    expect(h.log).toEqual(['busy:true', 'error:null', 'busy:false']);
  });

  it('a handler that returns a message keeps the dialog open and shows it; pressing again is allowed afterwards', async () => {
    const h = hooks();
    const onConfirm = vi.fn()
      .mockReturnValueOnce('This account has changed since you opened this. Nothing was deleted.')
      .mockReturnValueOnce(undefined);
    const run = makeConfirmRunner(() => onConfirm, h);
    await run.go();
    expect(h.log).toContain('error:This account has changed since you opened this. Nothing was deleted.');
    await run.go();
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(h.log.at(-1)).toBe('busy:false');
  });

  it('a handler that throws shows its message (or a plain fallback) and does not lock the dialog', async () => {
    const h = hooks();
    const run = makeConfirmRunner(() => () => { throw new Error('Could not save.'); }, h);
    await run.go();
    expect(h.log).toContain('error:Could not save.');
    expect(run.running).toBe(false);
    const h2 = hooks();
    const run2 = makeConfirmRunner(() => async () => { throw 'odd'; }, h2);
    await run2.go();
    expect(h2.log).toContain('error:Nothing was changed.');
  });

  it('success (nothing, true or false returned) raises no error and the runner never closes the dialog itself', async () => {
    for (const r of [undefined, true, false]) {
      const h = hooks();
      await makeConfirmRunner(() => () => r, h).go();
      expect(h.log.filter((l) => l.startsWith('error:') && l !== 'error:null')).toEqual([]);
    }
  });

  it('it always runs the newest handler (the caller re-checks its own conditions inside it)', async () => {
    let current = vi.fn();
    const run = makeConfirmRunner(() => current, hooks());
    const newer = vi.fn();
    current = newer;
    await run.go();
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it('the danger and primary confirmations that exist today are still the shared one (no second dialog framework appeared)', () => {
    const callers = ['src/pages/BackupPage.tsx', 'src/pages/SyncPage.tsx', 'src/pages/LedgerPage.tsx', 'src/modules/contacts/RemoveContact.tsx', 'src/modules/family/MemberPage.tsx', 'src/modules/family/DatesPage.tsx', 'src/modules/family/ImportantContacts.tsx'];
    for (const f of callers) expect(read(f), f).toMatch(/ConfirmDialog/);
    // the caller-owned safeguards are still in place
    expect(read('src/pages/LedgerPage.tsx')).toMatch(/deleteAccountWithTransactions\(db, id\); \/\/ re-checks inside one transaction/);
  });
});

// ---------------------------------------------------------------- 4. screen errors
const Hello: ComponentType = () => createElement('p', null, 'the screens');
const Waiting: ComponentType = () => createElement('i', null, 'waiting');
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/BillsModule-abc.js');
const bug = () => new TypeError("Cannot read properties of undefined (reading 'secret-field')");

describe('D20 a screen that fails while drawing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the failed-page state names the problem, says saved records are not deleted, and offers retry, a safe place and a reload', () => {
    const out = html(createElement(PageProblem, { onRetry: () => undefined }));
    const root = parseHtml(out);
    expect(out.match(/<main/g)).toHaveLength(1);
    expect(all(root, (e) => e.tag === 'h1')).toHaveLength(1);
    expect(txt(out)).toContain('This page ran into a problem.');
    expect(txt(out)).toContain('does not mean your saved records were deleted or changed');
    expect(out).toContain('role="alert"');
    expect(txt(out)).toContain('Try again');
    expect(txt(out)).toContain('Reload Ledger');
    const link = all(root, (e) => e.tag === 'a')[0];
    expect(link.attrs.href).toBe(SAFE_PLACE_HREF);
    expect(SAFE_PLACE_HREF).toBe('#/today');
    expect(txt(out)).toContain('Go to Today');
  });

  it('it separates a lost draft from saved data and never promises to keep unsaved edits', () => {
    const t = txt(html(createElement(PageProblem, { onRetry: () => undefined })));
    expect(t).toContain('keeps everything you have saved');
    expect(t).toContain('discard anything you typed into an open form');
    expect(t).not.toMatch(/your (changes|edits) (are|were|will be) (kept|saved|preserved)/i);
  });

  it('inside a page frame (bare) it adds no second main landmark', () => {
    const out = html(createElement(PageProblem, { bare: true, onRetry: () => undefined }));
    expect(out).not.toContain('<main');
    expect(out).toContain('<h1');
  });

  it('it never prints technical detail, a stack, or what the error said', () => {
    const b = new ModuleLoadBoundary({ name: 'Ledger', component: Hello, children: null });
    b.state = { error: bug(), attempt: 0 };
    const out = html(b.render() as never);
    expect(out).not.toContain('secret-field');
    expect(out).not.toMatch(/TypeError|at \w+ \(|stack/i);
  });

  it('a normal render error is caught by the module boundary and drawn as the page state, not rethrown', () => {
    const b = new ModuleLoadBoundary({ name: 'Ledger', component: Hello, children: null });
    expect(ModuleLoadBoundary.getDerivedStateFromError(bug())).toEqual({ error: expect.any(TypeError) });
    b.state = { error: bug(), attempt: 0 };
    expect(() => b.render()).not.toThrow();
    expect(txt(html(b.render() as never))).toContain('This page ran into a problem.');
  });

  it('a chunk-loading failure still gets its own message and the existing retry, and the retry re-arms the loader', async () => {
    let online = false;
    const load = vi.fn(async () => { if (!online) throw chunkError(); return { default: Hello }; });
    const C = lazyModule(load);
    await preloadLazyModule(C);
    const b = new ModuleLoadBoundary({ name: 'Bills', component: C, children: null });
    b.state = { error: chunkError(), attempt: 0 };
    expect(txt(html(b.render() as never))).toContain('Bills did not load');
    const setState = vi.fn();
    (b as unknown as { setState: unknown }).setState = setState;
    online = true;
    b.retry();
    expect((setState.mock.calls[0][0] as (s: { error: unknown; attempt: number }) => unknown)({ error: chunkError(), attempt: 4 })).toEqual({ error: null, attempt: 5 });
    await preloadLazyModule(C);
    expect(html(createElement(PendingView.Provider, { value: Waiting }, createElement(C)))).toBe('<p>the screens</p>');
  });

  it('retry after a page error clears it and draws the page again (a new attempt), without touching the file loader; a second failure shows the state again with no automatic retry', () => {
    const b = new ModuleLoadBoundary({ name: 'Ledger', component: Hello, children: null });
    const setState = vi.fn();
    (b as unknown as { setState: unknown }).setState = setState;
    b.retry();
    expect(setState).toHaveBeenCalledTimes(1); // exactly once: nothing retries by itself
    const next = (setState.mock.calls[0][0] as (s: { error: unknown; attempt: number }) => { error: unknown; attempt: number })({ error: bug(), attempt: 0 });
    expect(next).toEqual({ error: null, attempt: 1 });
    // the page fails again: the boundary is back in the failed state and stays there until a person acts
    b.state = { ...ModuleLoadBoundary.getDerivedStateFromError(bug()), attempt: 1 };
    expect(txt(html(b.render() as never))).toContain('This page ran into a problem.');
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('going to another address clears a page error (not a fetch failure), once, and does nothing when the address is unchanged', () => {
    const mk = (error: unknown) => {
      const b = new ModuleLoadBoundary({ name: 'Ledger', component: Hello, resetKey: '/accounts', children: null });
      b.state = { error, attempt: 0 };
      const setState = vi.fn();
      (b as unknown as { setState: unknown }).setState = setState;
      return { b, setState };
    };
    const a = mk(bug());
    setProps(a.b, { ...a.b.props, resetKey: '/budget' });
    a.b.componentDidUpdate({ name: 'Ledger', component: Hello, resetKey: '/accounts', children: null });
    expect(a.setState).toHaveBeenCalledTimes(1);
    const same = mk(bug());
    same.b.componentDidUpdate({ name: 'Ledger', component: Hello, resetKey: '/accounts', children: null });
    expect(same.setState).not.toHaveBeenCalled();
    const chunk = mk(chunkError());
    setProps(chunk.b, { ...chunk.b.props, resetKey: '/budget' });
    chunk.b.componentDidUpdate({ name: 'Ledger', component: Hello, resetKey: '/accounts', children: null });
    expect(chunk.setState).not.toHaveBeenCalled(); // the existing fetch-failure behaviour is not changed by navigation
    const healthy = mk(null);
    setProps(healthy.b, { ...healthy.b.props, resetKey: '/budget' });
    healthy.b.componentDidUpdate({ name: 'Ledger', component: Hello, resetKey: '/accounts', children: null });
    expect(healthy.setState).not.toHaveBeenCalled();
  });

  it('the page boundary inside Ledger shows the state without a second main, passes a fetch failure up, and resets on a new page', () => {
    const b = new PageErrorBoundary({ resetKey: '/budget', children: null });
    b.state = { error: bug(), attempt: 0 };
    const out = html(b.render() as never);
    expect(out).not.toContain('<main');
    expect(txt(out)).toContain('This page ran into a problem.');
    b.state = { error: chunkError(), attempt: 0 };
    expect(() => b.render()).toThrow(/dynamically imported/);
    b.state = { error: bug(), attempt: 0 };
    const setState = vi.fn();
    (b as unknown as { setState: unknown }).setState = setState;
    setProps(b, { resetKey: '/accounts', children: null });
    b.componentDidUpdate({ resetKey: '/budget' });
    expect(setState).toHaveBeenCalledTimes(1);
    expect(((setState.mock.calls[0][0]) as (s: { attempt: number }) => unknown)({ attempt: 2 })).toEqual({ error: null, attempt: 3 });
  });

  it('a failed draw is recorded in the local console only, never for a fetch failure, and nothing is sent anywhere', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const b = new ModuleLoadBoundary({ name: 'Ledger', component: Hello, children: null });
    b.componentDidCatch(bug(), { componentStack: '\n at Page' } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    b.componentDidCatch(chunkError(), { componentStack: '' } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the boundary code never touches stored data, storage or the network', () => {
    const src = read('src/shell/ModuleLoader.tsx');
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|from '\.\.\/db'|fetch\(|sendBeacon|XMLHttpRequest|\.clear\(\)/);
  });

  it('the app wires both boundaries: every module and Settings reset on a new address, and Ledger shields each page inside its own frame', () => {
    const app = read('src/App.tsx');
    expect(app.match(/resetKey=\{loc\.pathname\}/g)).toHaveLength(2);
    const shell = read('src/shell/Shell.tsx');
    expect(shell).toMatch(/<PageErrorBoundary resetKey=\{loc\.pathname\}>\{children\}<\/PageErrorBoundary>/);
    expect(shell.indexOf('<LedgerNav')).toBeLessThan(shell.indexOf('<PageErrorBoundary')); // the navigation is outside the shielded part
  });

  it('loading and failed-to-load states keep their landmarks and announcements, with no inline style left', () => {
    const loading = html(createElement(ModuleLoading, { name: 'Bills', delayMs: 0 }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('data-module-loading');
    expect(loading).not.toContain('style=');
    const failed = html(createElement(ModuleLoadFailed, { name: 'Bills', onRetry: () => undefined }));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('style=');
    expect(failed.match(/<h1/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 5. the stylesheet contract
describe('D20 stylesheet: dialogs on tokens, sized and scrolling sensibly', () => {
  const styles = read('src/styles.css');
  const comps = read('src/ui/components.css');
  it('the box scrolls inside the visible backdrop, with a sticky title bar and a sticky form action row', () => {
    expect(styles).toMatch(/\.modal \{[^}]*max-height: 100%;[^}]*overflow: auto;/);
    expect(styles).toMatch(/\.modal-head \{ position: sticky; top: 0;/);
    expect(styles).toMatch(/\.modal form > \.row\[class\*="-actions"\]:not\(\.fm-actions\) \{ position: sticky;/);
    expect(styles).toMatch(/\.modal\.modal--sm \{ width: min\(420px, 100%\); \}/);
  });
  it('the backdrop follows the visible area and the home-indicator inset', () => {
    expect(styles).toMatch(/\.modal-back \{[^}]*top: var\(--sheet-top, 0px\); bottom: var\(--sheet-bottom, 0px\);/);
    expect(styles).toMatch(/env\(safe-area-inset-bottom\)/);
  });
  it('no new colour literal: the D20 rules use tokens only', () => {
    const d20 = comps.slice(comps.indexOf('D20: dialog content'));
    expect(d20).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(d20).not.toMatch(/!important/);
  });
  it('a confirmation is not wider than a small dialog, and its destructive action is filled only inside the confirmation', () => {
    expect(styles).toMatch(/\.confirm-actions button\.danger:not\(:disabled\) \{ background: var\(--neg-soft\)/);
    expect(styles).not.toMatch(/\n button\.danger \{[^}]*background: var\(--neg\)/);
  });
});

// ---------------------------------------------------------------- 6. opening and dismissing change no stored data
describe('D20 opening and dismissing a dialog changes nothing that is stored', () => {
  beforeAll(async () => { await db.open(); });

  it('drawing, Escape, a click-outside close and a Cancel leave every table exactly as it was', async () => {
    await db.accounts.add({ name: 'Test Checking', kind: 'checking', openingBalanceCents: 12345 } as never);
    const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, JSON.stringify(await t.toArray())])));
    const before = await snapshot();
    // draw a plain dialog and a confirmation, then dismiss both the ways a person can
    html(modal({ title: 'Edit asset' }));
    html(createElement(ConfirmDialog, { title: 'Delete?', confirmLabel: 'Delete', onConfirm: () => 'refused', onCancel: () => undefined, children: 'x' }));
    const p = page();
    const cancel = vi.fn();
    attachModal(p.doc, p.box([p.el()]), guardedClose(() => false, cancel))();
    p.press('Escape');
    guardedClose(() => false, cancel)();
    expect(await snapshot()).toEqual(before);
  });
});
