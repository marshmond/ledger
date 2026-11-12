import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { accessibleName, all, parseHtml, textOf, type El } from '../lib/a11yTestkit';

/**
 * D7 correction: on a phone the bar hides the sync chip, EXCEPT when sync needs attention (an error, or edits to review), when it shows as a
 * warning icon button. The decision is a class on the wrapper (`attn`) derived from the existing status; no sync logic is touched.
 */
const status = vi.hoisted(() => ({ value: { configured: true, auto: true, state: 'idle', conflicts: 0 } as Record<string, unknown> }));
vi.mock('../lib/sync/auto', () => ({ useSyncStatus: () => status.value, syncNow: () => Promise.resolve() }));

const css = readFileSync('src/styles.css', 'utf8');
async function chip(patch: Record<string, unknown>, inline = false): Promise<El> {
  status.value = { configured: true, auto: true, state: 'idle', conflicts: 0, ...patch };
  const { default: SyncChip } = await import('../core/SyncChip');
  return parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SyncChip as never, { inline } as never))));
}
const wrap = (d: El) => all(d, (e) => e.tag === 'div' && (e.attrs.class ?? '').startsWith('syncwrap'))[0];
const button = (d: El) => all(d, (e) => e.tag === 'button')[0];

describe('D7 sync attention indicator: which states reach the phone bar', () => {
  it('error: attention, with a warning icon, the words kept, and a popover button', async () => {
    const d = await chip({ state: 'error', error: 'The last sync did not finish.' });
    expect(wrap(d).attrs.class).toBe('syncwrap attn');
    expect(button(d).attrs.class).toBe('syncchip bad');
    expect(button(d).attrs['aria-haspopup']).toBe('dialog');
    expect(accessibleName(d, button(d))).toBe('Needs attention'); // the icon is hidden from assistive technology; the words are the name
    expect(button(d).attrs.title).toBe('The last sync did not finish.');
    const icon = all(d, (e) => e.tag === 'svg')[0];
    expect(icon.attrs['aria-hidden']).toBe('true');
    expect(icon.attrs.class).toContain('syncicon');
  });

  it('edits to review (conflict): attention, "Review 2", warning tone', async () => {
    const d = await chip({ conflicts: 2 });
    expect(wrap(d).attrs.class).toBe('syncwrap attn');
    expect(button(d).attrs.class).toBe('syncchip warn');
    expect(textOf(button(d))).toBe('Review 2');
  });

  it.each([
    ['healthy', {}],
    ['syncing', { state: 'syncing' }],
    ['paused (automatic sync off)', { auto: false }],
  ])('%s: not attention, so the clean phone header is kept', async (_n, patch) => {
    const d = await chip(patch);
    expect(wrap(d).attrs.class).toBe('syncwrap');
  });

  it('sync not set up: the plain "Sync off" link, never an attention indicator', async () => {
    const d = await chip({ configured: false });
    expect(all(d, (e) => (e.attrs.class ?? '').includes('syncwrap'))).toHaveLength(0);
    const a = all(d, (e) => e.tag === 'a')[0];
    expect(a.attrs.href).toBe('/settings/sync');
    expect(textOf(a)).toBe('Sync off');
  });

  it('the copy inside the phone list is marked inline and carries the same state', async () => {
    const d = await chip({ state: 'error' }, true);
    expect(wrap(d).attrs.class).toBe('syncwrap inline attn');
  });
});

describe('D7 sync attention indicator: the stylesheet', () => {
  const phone = css.slice(css.indexOf('D7: the header on a phone'));
  it('hides the bar copy on a phone unless it needs attention, and shows an icon with the words kept for screen readers', () => {
    expect(phone).toMatch(/\.modulebar > \.syncwrap:not\(\.attn\), \.modulebar > \.syncchip, \.modulebar > \.modsettings \{ display: none; \}/);
    expect(phone).toMatch(/\.syncwrap\.attn \.syncchip \{[^}]*min-width: 44px/); // touch target
    expect(phone).toMatch(/\.syncwrap\.attn \.syncicon \{ display: block; \}/); // shape cue, not colour alone
    expect(phone).toMatch(/\.syncwrap\.attn \.synctext \{ position: absolute; width: 1px;/); // visually hidden, still read
    expect(phone).toMatch(/\.syncchip\.bad \.syncicon \{ color: var\(--neg-text\); \}/);
    expect(phone).toMatch(/\.syncchip\.warn \.syncicon \{ color: var\(--warn-text\); \}/);
  });
  it('the icon is hidden everywhere else (computer and the list foot)', () => {
    expect(css).toMatch(/^\.syncicon \{ display: none; flex: none; \}$/m);
  });
});

describe('D7 sync chip focus', () => {
  it('Escape closes the details and puts focus back on the chip when focus was inside them', () => {
    const src = readFileSync('src/core/SyncChip.tsx', 'utf8');
    expect(src).toMatch(/wrap\.current\?\.contains\(document\.activeElement\)\) chip\.current\?\.focus\(\)/);
    expect(src).not.toMatch(/syncNow\(\)[^;]*useEffect/); // no new sync trigger in the chip
  });
});
