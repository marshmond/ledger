import { describe, expect, it, vi } from 'vitest';
import { attachModal, type BoxLike, type DocLike, type FocusableLike, type KeyEventLike } from './modalKeys';

/** A tiny stand-in for the page (the test environment has no DOM). Elements know how to take focus. */
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
  return { doc, el, box, press, handlers, modals };
}

describe('Modal keyboard and focus behaviour', () => {
  it('Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last', () => {
    const p = page();
    const [a, b, c] = [p.el(), p.el(), p.el()];
    attachModal(p.doc, p.box([a, b, c]), () => undefined);
    c.focus();
    expect(p.press('Tab').prevented).toBe(true);
    expect(p.doc.activeElement).toBe(a);
    expect(p.press('Tab', true).prevented).toBe(true);
    expect(p.doc.activeElement).toBe(c);
  });
  it('Tab in the middle is left to the browser; Shift+Tab from the dialog box itself goes to the last control', () => {
    const p = page();
    const [a, b, c] = [p.el(), p.el(), p.el()];
    const box = p.box([a, b, c]);
    attachModal(p.doc, box, () => undefined);
    b.focus();
    expect(p.press('Tab').prevented).toBe(false);
    expect(p.press('Tab', true).prevented).toBe(false);
    box.focus();
    expect(p.press('Tab', true).prevented).toBe(true);
    expect(p.doc.activeElement).toBe(c);
  });
  it('focus that has left the dialog is pulled back in', () => {
    const p = page();
    const [a, b] = [p.el(), p.el()];
    attachModal(p.doc, p.box([a, b]), () => undefined);
    p.doc.activeElement = {};
    p.press('Tab');
    expect(p.doc.activeElement).toBe(a);
  });
  it('hidden and disabled controls are skipped when finding the first and last', () => {
    const p = page();
    const hidden = p.el({ getClientRects: () => [] }), off = p.el({ disabled: true }), a = p.el(), b = p.el();
    attachModal(p.doc, p.box([hidden, a, b, off]), () => undefined);
    b.focus();
    p.press('Tab');
    expect(p.doc.activeElement).toBe(a);
  });
  it('a dialog with no focusable controls does not trap or throw', () => {
    const p = page();
    attachModal(p.doc, p.box([]), () => undefined);
    const e = p.press('Tab');
    expect(e.prevented).toBe(false);
    expect(() => p.press('Tab', true)).not.toThrow();
  });
  it('focus moves into the dialog on open, and back to where it was on close', () => {
    const p = page();
    const opener = p.el();
    opener.focus();
    const box = p.box([p.el()]);
    const detach = attachModal(p.doc, box, () => undefined);
    expect(p.doc.activeElement).toBe(box);
    detach();
    expect(p.doc.activeElement).toBe(opener);
    expect(p.handlers).toHaveLength(0); // the listener is removed
  });
  it('a field inside that already has focus keeps it (it is not stolen)', () => {
    const p = page();
    const field = p.el();
    attachModal(p.doc, p.box([field]), () => undefined);
    p.doc.activeElement = null;
    const p2 = page();
    const f2 = p2.el();
    const b2 = p2.box([f2]);
    f2.focus();
    attachModal(p2.doc, b2, () => undefined);
    expect(p2.doc.activeElement).toBe(f2);
  });
  it('with two dialogs open, only the topmost one traps Tab (the other leaves the key alone)', () => {
    const p = page();
    const [a1, b1] = [p.el(), p.el()], [a2, b2] = [p.el(), p.el()];
    attachModal(p.doc, p.box([a1, b1]), () => undefined);
    attachModal(p.doc, p.box([a2, b2]), () => undefined); // opened last = topmost
    const spy = vi.spyOn(a1, 'focus'), spyB = vi.spyOn(b1, 'focus');
    b2.focus();
    p.press('Tab');
    expect(p.doc.activeElement).toBe(a2); // wrapped inside the top dialog only
    expect(spy).not.toHaveBeenCalled(); // the dialog underneath never grabbed focus
    expect(spyB).not.toHaveBeenCalled();
  });
  it('Escape closes, is not passed on, and Tab alone does not close', () => {
    const p = page();
    const close = vi.fn();
    attachModal(p.doc, p.box([p.el()]), close);
    p.press('Tab');
    expect(close).not.toHaveBeenCalled();
    const e = p.press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.stop).toBe(true);
  });
  it('known limit (unchanged): with two dialogs open, Escape reaches both', () => {
    const p = page();
    const c1 = vi.fn(), c2 = vi.fn();
    attachModal(p.doc, p.box([p.el()]), c1);
    attachModal(p.doc, p.box([p.el()]), c2);
    p.press('Escape');
    expect([c1.mock.calls.length, c2.mock.calls.length]).toEqual([1, 1]);
  });
  it('works with no box (a dialog not yet mounted): no crash, Escape still closes', () => {
    const p = page();
    const close = vi.fn();
    attachModal(p.doc, null, close);
    expect(() => p.press('Tab')).not.toThrow();
    p.press('Escape');
    expect(close).toHaveBeenCalled();
  });

  it('focus goes back to the button that OPENED the dialog even when a field inside took focus first (an autofocused search box)', () => {
    const p = page();
    const opener = p.el();
    const field = p.el();
    p.doc.activeElement = opener;
    const openerSeenBeforeDrawing = p.doc.activeElement; // what Modal reads during its first render
    field.focus(); // the autofocused field takes focus during the commit, before the effect runs
    const b = p.box([field]);
    const detach = attachModal(p.doc, b, () => undefined, openerSeenBeforeDrawing);
    expect(p.doc.activeElement).toBe(field);
    detach();
    expect(p.doc.activeElement).toBe(opener);
  });

  it('without a recorded opener the old behaviour is unchanged (the element focused when the dialog attached)', () => {
    const p = page();
    const before = p.el();
    before.focus();
    const b = p.box([p.el()]);
    const detach = attachModal(p.doc, b, () => undefined);
    detach();
    expect(p.doc.activeElement).toBe(before);
  });
});
