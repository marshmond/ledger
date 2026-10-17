import { useState, type CSSProperties } from 'react';
import { COLOR_ROLES, PRESETS, CLASSIC, colorsOf, contrastNotes, isHex, loadPalette, savePalette, varsFor, type Colors, type ColorKey, type PaletteChoice, type PaletteId } from '../palette';
import { applyTheme, loadTheme } from '../theme';
import ThemeToggle from './ThemeToggle';

const NAMES: Record<PaletteId, string> = { classic: 'Classic blue', teal: 'Calm teal', navy: 'Deep navy and gold', forest: 'Forest green and stone', slate: 'Slate and indigo', custom: 'My own colors' };
const BLURB: Record<string, string> = { classic: 'The original look: clean white and blue.', ...Object.fromEntries(PRESETS.map((p) => [p.id, p.blurb])), custom: 'Pick every color yourself, for light and dark.' };

const dots = (c: Colors) => [c.bg, c.card, c.accent, c.pos, c.neg, c.sideBg];

/** One row of the color map: a name, what it colors, a color picker, and the hex code. */
function ColorRow({ role, value, onChange }: { role: (typeof COLOR_ROLES)[number]; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const shown = isHex(text) ? text : value;
  return (
    <div className="colorrow">
      <input type="color" aria-label={`${role.label} color`} value={shown.toLowerCase()} onChange={(e) => { setText(e.target.value); onChange(e.target.value.toUpperCase()); }} />
      <div className="info">
        <strong>{role.label}</strong>
        <div className="muted" style={{ fontSize: '0.8rem' }}>{role.help}</div>
      </div>
      <input
        className="hex"
        aria-label={`${role.label} hex code`}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (isHex(e.target.value)) onChange(e.target.value.toUpperCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

/** Light/Dark/Device mode, plus the color palette: four presets or your own. */
export default function AppearanceCard() {
  const [choice, setChoiceState] = useState<PaletteChoice>(() => loadPalette());
  const [editing, setEditing] = useState<'light' | 'dark'>('light');
  const [base, setBase] = useState<PaletteId>('classic');

  const set = (c: PaletteChoice) => {
    setChoiceState(c);
    savePalette(c);
    applyTheme(loadTheme()); // re-applies the colors for the mode now in effect
  };
  const baseColors = (id: PaletteId, dark: boolean): Colors => colorsOf({ id, custom: choice.custom }, dark) ?? CLASSIC[dark ? 'dark' : 'light'];
  const custom = choice.id === 'custom' && choice.custom ? choice.custom : null;
  const current = custom ? custom[editing] : null;
  const notes = current ? contrastNotes(current) : [];

  const startCustom = (from: PaletteId) => set({ id: 'custom', custom: { light: { ...baseColors(from, false) }, dark: { ...baseColors(from, true) } } });
  const update = (key: ColorKey, hex: string) => {
    if (!custom) return;
    set({ id: 'custom', custom: { ...custom, [editing]: { ...custom[editing], [key]: hex } } });
  };

  return (
    <div className="card">
      <strong>Appearance</strong>
      <p className="muted">Mode follows your phone or computer (Device), or you can force Light or Dark. Colors are chosen separately, below. Both are remembered on this device only.</p>
      <ThemeToggle />

      <h3>Colors</h3>
      <div className="pal-grid" role="radiogroup" aria-label="Color palette">
        {(['classic', ...PRESETS.map((p) => p.id), 'custom'] as PaletteId[]).map((id) => {
          const sample = id === 'custom' ? (custom?.light ?? CLASSIC.light) : id === 'classic' ? CLASSIC.light : PRESETS.find((p) => p.id === id)!.light;
          const sampleDark = id === 'custom' ? (custom?.dark ?? CLASSIC.dark) : id === 'classic' ? CLASSIC.dark : PRESETS.find((p) => p.id === id)!.dark;
          return (
            <button key={id} role="radio" aria-checked={choice.id === id} className={`pal ${choice.id === id ? 'on' : ''}`} onClick={() => (id === 'custom' ? (custom ? set(choice) : startCustom(base)) : set({ id }))}>
              <strong>{NAMES[id]}</strong>
              <div className="swatches" aria-hidden="true">{dots(sample).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <div className="swatches" aria-hidden="true">{dots(sampleDark).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <div className="muted">{BLURB[id]}</div>
            </button>
          );
        })}
      </div>

      {choice.id === 'custom' && custom && current && (
        <>
          <h3>Your colors</h3>
          <p className="muted">Pick a color for each part of the app. Light and dark are set separately, so choose which one you are editing. Anything hard to read is flagged.</p>
          <div className="row">
            <div className="seg" role="group" aria-label="Which mode to edit">
              <button className={editing === 'light' ? 'on' : ''} onClick={() => setEditing('light')}>Light mode</button>
              <button className={editing === 'dark' ? 'on' : ''} onClick={() => setEditing('dark')}>Dark mode</button>
            </div>
            <label className="row">Start over from
              <select value={base} onChange={(e) => { const id = e.target.value as PaletteId; setBase(id); if (confirm(`Replace your colors with ${NAMES[id]}?`)) startCustom(id); }}>
                {(['classic', ...PRESETS.map((p) => p.id)] as PaletteId[]).map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}
              </select>
            </label>
          </div>
          <div className="colormap">
            {COLOR_ROLES.map((r) => <ColorRow key={`${editing}-${r.key}-${current[r.key]}`} role={r} value={current[r.key]} onChange={(hex) => update(r.key, hex)} />)}
          </div>
          {notes.length > 0 && (
            <ul className="warn">{notes.map((n, i) => <li key={i}>{n.message} (contrast {n.ratio.toFixed(1)}, aim for {n.min} or more)</li>)}</ul>
          )}
          <strong>Preview ({editing} mode)</strong>
          <div className="samples" style={varsFor(current) as CSSProperties}>
            <div className="sample-side">
              <strong>Ledger</strong>
              <span className="on">Budget</span>
              <span>Transactions</span>
              <span>Investments</span>
            </div>
            <div className="sample-main">
              <strong>Net worth</strong>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>$412,350.00</div>
              <div className="muted">Up <span className="pos">$12,400</span> this year, <span className="neg">$310</span> over budget, <span className="warn">backup due</span></div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="primary">Primary</button>
                <button>Secondary</button>
                <a href="#/more" onClick={(e) => e.preventDefault()}>A link</a>
              </div>
              <div className="card" style={{ marginTop: 6 }}>A card with some text.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
