import { describe, expect, it } from 'vitest';
import { wantsAddShortcut } from './GlobalFrame';

const press = (key: string, over: Partial<Parameters<typeof wantsAddShortcut>[0]> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, ...over });

describe('the N key opens the Add box', () => {
  it('works for n and N when nothing else is going on', () => {
    expect(wantsAddShortcut(press('n'), false, false)).toBe(true);
    expect(wantsAddShortcut(press('N'), false, false)).toBe(true);
  });
  it('does nothing while typing in a box', () => {
    expect(wantsAddShortcut(press('n'), true, false)).toBe(false);
  });
  it('does nothing with Ctrl, Cmd or Alt held (so browser shortcuts like Ctrl+N are left alone)', () => {
    expect(wantsAddShortcut(press('n', { ctrlKey: true }), false, false)).toBe(false);
    expect(wantsAddShortcut(press('n', { metaKey: true }), false, false)).toBe(false);
    expect(wantsAddShortcut(press('n', { altKey: true }), false, false)).toBe(false);
  });
  it('does nothing while a dialog is open, when the key is held down, or when something else already handled it', () => {
    expect(wantsAddShortcut(press('n'), false, true)).toBe(false);
    expect(wantsAddShortcut(press('n', { repeat: true }), false, false)).toBe(false);
    expect(wantsAddShortcut(press('n', { defaultPrevented: true }), false, false)).toBe(false);
  });
  it('ignores other keys', () => {
    expect(wantsAddShortcut(press('m'), false, false)).toBe(false);
    expect(wantsAddShortcut(press('/'), false, false)).toBe(false);
  });
});
