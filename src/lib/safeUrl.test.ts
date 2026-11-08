import { describe, expect, it } from 'vitest';
import { isSafeUrl } from './safeUrl';
import { isSafeUrl as assets } from '../modules/assets/validate';
import { isSafeUrl as bills } from '../modules/bills/util';
import { isSafeUrl as services } from '../modules/services/model';
import { validateObligation } from '../modules/bills/model';
import { ob as billData } from '../modules/bills/billsTestkit';
import { blankArrangement, validateArrangement } from '../modules/services/model';

/** ST-S2 (ARCH-02): one shared link check; Home & Assets, Household Services and Bills all use it and keep their old behaviour for every input. */
const GOOD = ['https://example.com', 'http://example.com/a?b=1#c', 'HTTPS://EXAMPLE.COM', 'Http://Example.com', '  https://example.com/x  ', 'https://example.com:8443/path', 'https://user@example.com'];
const BAD = ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'blob:https://example.com/uuid', 'vbscript:msgbox(1)', 'ftp://example.com', 'mailto:a@example.com', 'tel:5551234', '//example.com', '/relative/path', '../up', 'example.com', 'www.example.com', '', '   ', 'https://', 'http:/', 'not a url', 'about:blank'];

describe('safe external links', () => {
  it.each(GOOD)('accepts %j', (u) => expect(isSafeUrl(u)).toBe(true));
  it.each(BAD)('refuses %j', (u) => expect(isSafeUrl(u)).toBe(false));
  it('the three modules use the very same function, so they cannot drift apart', () => {
    expect(assets).toBe(isSafeUrl);
    expect(bills).toBe(isSafeUrl);
    expect(services).toBe(isSafeUrl);
  });
  it('every module still gives the same message for a bad link, and accepts a good one', () => {
    const msg = 'Links must start with http:// or https://.';
    const ob = (url: string) => validateObligation(billData({ title: 'Test', refs: [{ label: 'Doc', url }] } as never, '2026-11-08'));
    const arr = (url: string) => validateArrangement(blankArrangement({ title: 'Test', refs: [{ label: 'Doc', url }] } as never));
    for (const u of BAD.filter((x) => x.trim() !== '')) { expect(ob(u)).toBe(msg); expect(arr(u)).toBe(msg); }
    for (const u of GOOD) { expect(ob(u)).not.toBe(msg); expect(arr(u)).not.toBe(msg); }
  });
});
