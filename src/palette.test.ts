import { describe, expect, it } from 'vitest';
import { COLOR_ROLES, DEFAULT_CHOICE, PALETTE_KEY, PALETTE_VARS_KEY, PRESETS, colorsOf, contrastNotes, contrastRatio, isHex, loadPalette, onColor, parseChoice, resolvedVars, savePalette, varsFor, type Colors } from './palette';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('contrast math', () => {
  it('matches the known extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
  it('picks black or white text for a background', () => {
    expect(onColor('#FFFFFF')).toBe('#111111');
    expect(onColor('#0F766E')).toBe('#FFFFFF');
    expect(onColor('#2DD4BF')).toBe('#111111');
    expect(onColor('#1E3A8A')).toBe('#FFFFFF');
  });
  it('recognizes hex colors', () => {
    expect(isHex('#a1B2c3')).toBe(true);
    expect(isHex('a1b2c3')).toBe(false);
    expect(isHex('#abc')).toBe(false);
  });
});

describe('built-in palettes', () => {
  for (const p of PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${p.name} (${mode}) is readable`, () => {
        expect(contrastNotes(p[mode]).map((n) => `${n.key}: ${n.ratio.toFixed(2)} < ${n.min}`)).toEqual([]);
      });
      it(`${p.name} (${mode}) defines every color`, () => {
        for (const r of COLOR_ROLES) expect(isHex(p[mode][r.key])).toBe(true);
      });
    }
  }
  it('has five palettes (D21.1: Signature Navy, Coastal Slate, Evergreen, Warm Stone, Midnight Plum) with unique ids, Signature Navy first', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(5);
    expect(PRESETS.map((p) => p.id)).toEqual(['signature-navy', 'coastal-slate', 'evergreen', 'warm-stone', 'midnight-plum']);
    expect(PRESETS.map((p) => p.name)).toEqual(['Signature Navy', 'Coastal Slate', 'Evergreen', 'Warm Stone', 'Midnight Plum']);
  });
});

describe('warning about unreadable custom colors', () => {
  it('flags text that blends into the background', () => {
    const c: Colors = { ...PRESETS[0].light, fg: '#EEEEEE' };
    const notes = contrastNotes(c);
    expect(notes.map((n) => n.key)).toContain('fg');
    expect(notes[0].message).toMatch(/hard to read/);
  });
});

describe('variables and storage', () => {
  it('turns colors into CSS variables, including readable text on buttons', () => {
    const v = varsFor(PRESETS[2].light); // Evergreen
    expect(v['--accent']).toBe('#2F6A55');
    expect(v['--on-accent']).toBe('#FFFFFF');
    expect(v['--side-bg']).toBe(PRESETS[2].light.sideBg);
    expect(varsFor(PRESETS[2].dark)['--on-accent']).toBe('#111111');
  });
  it('Signature Navy is the default, and every choice resolves to variables', () => {
    expect(DEFAULT_CHOICE).toEqual({ id: 'signature-navy' });
    expect(colorsOf(DEFAULT_CHOICE, false).accent).toBe('#267880');
    expect(resolvedVars(DEFAULT_CHOICE).light['--page']).toBe('#EEF1F6');
  });
  it('saves a choice with its resolved variables for the pre-paint script (version 2)', () => {
    const s = store();
    savePalette({ id: 'coastal-slate' }, s);
    expect(JSON.parse(s.m.get(PALETTE_KEY)!)).toEqual({ id: 'coastal-slate' });
    const vars = JSON.parse(s.m.get(PALETTE_VARS_KEY)!);
    expect(vars.v).toBe(2);
    expect(vars.light['--accent']).toBe('#376679');
    expect(vars.dark['--accent']).toBe('#8DB5C7');
    expect(loadPalette(s)).toEqual({ id: 'coastal-slate' });
  });
  it('choosing Signature Navy is stored explicitly (so a backup carries it, and it can be told from never choosing)', () => {
    const s = store();
    savePalette(DEFAULT_CHOICE, s);
    expect(s.m.get(PALETTE_KEY)).toBe('{"id":"signature-navy"}');
    expect(loadPalette(s)).toEqual(DEFAULT_CHOICE);
  });
  it('round trips a custom palette', () => {
    const s = store();
    const custom = { light: { ...PRESETS[1].light, accent: '#AA3377' }, dark: { ...PRESETS[1].dark, accent: '#FF88CC' } };
    savePalette({ id: 'custom', custom }, s);
    const back = loadPalette(s);
    expect(back.id).toBe('custom');
    expect(back.custom!.light.accent).toBe('#AA3377');
    expect(colorsOf(back, true).accent).toBe('#FF88CC');
  });
  it('ignores damaged or unknown saved values (falls back to Signature Navy)', () => {
    expect(parseChoice('not json')).toEqual(DEFAULT_CHOICE);
    expect(parseChoice(JSON.stringify({ id: 'neon' }))).toEqual(DEFAULT_CHOICE);
    expect(parseChoice(JSON.stringify({ id: 'custom', custom: { light: {}, dark: {} } }))).toEqual(DEFAULT_CHOICE);
    expect(parseChoice(null)).toEqual(DEFAULT_CHOICE);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadPalette(throwing)).toEqual(DEFAULT_CHOICE);
    expect(() => savePalette({ id: 'evergreen' }, throwing)).not.toThrow();
  });
});
