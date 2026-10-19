import { useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { COLOR_ROLES, PRESETS, CLASSIC, colorsOf, contrastNotes, isHex, loadPalette, savePalette, varsFor, type Colors, type ColorKey, type PaletteChoice, type PaletteId } from '../palette';
import { LIMIT_MESSAGE, addTheme, atLimit, checkThemeName, decodeTheme, encodeTheme, newThemeId, parseThemes, removeTheme, renameTheme, sameColors, uniqueName, updateTheme, type SavedTheme } from '../lib/savedThemes';
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

/** Light/Dark/Device mode, plus the color palette: four presets, your own colors, and your saved themes. */
export default function AppearanceCard() {
  const [choice, setChoiceState] = useState<PaletteChoice>(() => loadPalette());
  const [editing, setEditing] = useState<'light' | 'dark'>('light');
  const [base, setBase] = useState<PaletteId>('classic');
  const saved = useLiveQuery(async () => parseThemes((await db.settings.get('savedThemes'))?.value), []);
  const themes: SavedTheme[] = saved ?? [];
  const [naming, setNaming] = useState<null | 'new' | 'rename'>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [pasted, setPasted] = useState('');
  const [msg, setMsg] = useState('');

  const set = (c: PaletteChoice) => {
    setChoiceState(c);
    savePalette(c);
    applyTheme(loadTheme()); // re-applies the colors for the mode now in effect
  };
  const baseColors = (id: PaletteId, dark: boolean): Colors => colorsOf({ id, custom: choice.custom }, dark) ?? CLASSIC[dark ? 'dark' : 'light'];
  const custom = choice.id === 'custom' && choice.custom ? choice.custom : null;
  const current = custom ? custom[editing] : null;
  const notes = current ? contrastNotes(current) : [];
  const active = themes.find((t) => t.id === choice.savedId);
  const changed = !!active && !!custom && !sameColors(custom, active);

  const startCustom = (from: PaletteId) => set({ id: 'custom', custom: { light: { ...baseColors(from, false) }, dark: { ...baseColors(from, true) } } });
  const update = (key: ColorKey, hex: string) => {
    if (!custom) return;
    set({ id: 'custom', custom: { ...custom, [editing]: { ...custom[editing], [key]: hex } }, ...(choice.savedId ? { savedId: choice.savedId } : {}) });
  };

  const store = (list: SavedTheme[]) => db.settings.put({ key: 'savedThemes', value: list });
  const openName = (mode: 'new' | 'rename') => { setNaming(mode); setName(mode === 'rename' ? active?.name ?? '' : ''); setErr(''); setMsg(''); };

  async function commitName() {
    const problem = checkThemeName(themes, name, naming === 'rename' ? active?.id : undefined);
    if (problem) return setErr(problem);
    if (naming === 'rename' && active) await store(renameTheme(themes, active.id, name));
    else if (custom) {
      if (atLimit(themes)) return setErr(LIMIT_MESSAGE);
      const id = newThemeId();
      await store(addTheme(themes, name, custom, id));
      set({ id: 'custom', custom, savedId: id });
    }
    setNaming(null);
  }

  async function importCode() {
    setMsg('');
    const d = decodeTheme(pasted);
    if (!d.ok) return setMsg(d.error);
    if (atLimit(themes)) return setMsg(LIMIT_MESSAGE);
    const id = newThemeId();
    const nm = uniqueName(themes, d.name);
    await store(addTheme(themes, nm, d, id));
    set({ id: 'custom', custom: { light: d.light, dark: d.dark }, savedId: id });
    setPasted('');
    setMsg(`Added “${nm}” and switched to it.`);
  }

  async function copyCode() {
    if (!custom) return;
    const text = encodeTheme({ name: active?.name ?? 'My theme', ...custom });
    setCode(text);
    try { await navigator.clipboard.writeText(text); setMsg('Theme code copied. Paste it into another copy of the app.'); } catch { setMsg('Copy the code from the box below.'); }
  }

  return (
    <div className="card">
      <strong>Appearance</strong>
      <p className="muted">Mode follows your phone or computer (Device), or you can force Light or Dark. Colors are chosen separately, below. Both are remembered on this device only, except your saved themes, which are kept with your data.</p>
      <ThemeToggle />

      <h3>Colors</h3>
      <div className="pal-grid" role="radiogroup" aria-label="Color palette">
        {(['classic', ...PRESETS.map((p) => p.id), 'custom'] as PaletteId[]).map((id) => {
          const sample = id === 'custom' ? (custom?.light ?? CLASSIC.light) : id === 'classic' ? CLASSIC.light : PRESETS.find((p) => p.id === id)!.light;
          const sampleDark = id === 'custom' ? (custom?.dark ?? CLASSIC.dark) : id === 'classic' ? CLASSIC.dark : PRESETS.find((p) => p.id === id)!.dark;
          const on = id === 'custom' ? choice.id === 'custom' && !active : choice.id === id;
          return (
            <button key={id} role="radio" aria-checked={on} className={`pal ${on ? 'on' : ''}`} onClick={() => (id === 'custom' ? (custom ? set({ id: 'custom', custom }) : startCustom(base)) : set({ id }))}>
              <strong>{NAMES[id]}</strong>
              <div className="swatches" aria-hidden="true">{dots(sample).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <div className="swatches" aria-hidden="true">{dots(sampleDark).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <div className="muted">{BLURB[id]}</div>
            </button>
          );
        })}
      </div>

      <h3>My themes</h3>
      {themes.length === 0 ? (
        <p className="muted">Nothing saved yet. Choose “My own colors”, adjust the colors, and save them here with a name. Saved themes sync to your other devices.</p>
      ) : (
        <div className="pal-grid" role="radiogroup" aria-label="My saved themes">
          {themes.map((t) => (
            <button key={t.id} role="radio" aria-checked={choice.savedId === t.id} className={`pal ${choice.savedId === t.id ? 'on' : ''}`} onClick={() => set({ id: 'custom', custom: { light: { ...t.light }, dark: { ...t.dark } }, savedId: t.id })}>
              <strong>{t.name}</strong>
              <div className="swatches" aria-hidden="true">{dots(t.light).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
              <div className="swatches" aria-hidden="true">{dots(t.dark).map((c, i) => <i key={i} style={{ background: c }} />)}</div>
            </button>
          ))}
        </div>
      )}
      <details style={{ marginTop: 8 }}>
        <summary>Add a theme from a code</summary>
        <p className="muted">Paste a theme code that was copied from another copy of the app.</p>
        <div className="row">
          <label className="f">Theme code<textarea rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} placeholder="ledger-theme-1:…" /></label>
          <button disabled={!pasted.trim()} onClick={importCode}>Add theme</button>
        </div>
      </details>
      {msg && <div className="muted" role="status">{msg}</div>}

      {choice.id === 'custom' && custom && current && (
        <>
          <h3>Your colors{active ? `: ${active.name}` : ''}</h3>
          <p className="muted">Pick a color for each part of the app. Light and dark are set separately, so choose which one you are editing. Anything hard to read is flagged.</p>
          <div className="row">
            {active && changed && <span className="warn">changed</span>}
            {active && changed && <button className="primary" onClick={() => store(updateTheme(themes, active.id, custom))}>Update “{active.name}”</button>}
            <button onClick={() => openName('new')}>Save as new theme…</button>
            {active && <button className="link" onClick={() => openName('rename')}>rename</button>}
            {active && <button className="link" onClick={async () => { if (confirm(`Delete the theme “${active.name}”? The colors stay on until you pick something else.`)) { await store(removeTheme(themes, active.id)); set({ id: 'custom', custom }); } }}>delete</button>}
            <button className="link" onClick={copyCode}>copy theme code</button>
          </div>
          {naming && (
            <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); commitName(); }}>
              <label className="f">{naming === 'rename' ? 'New name' : 'Name for this theme'}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></label>
              <button className="primary" type="submit">Save</button>
              <button type="button" onClick={() => setNaming(null)}>Cancel</button>
              {err && <span className="error" role="alert">{err}</span>}
            </form>
          )}
          {code && <textarea readOnly rows={3} value={code} onFocus={(e) => e.currentTarget.select()} aria-label="Theme code" style={{ width: '100%', marginTop: 6 }} />}
          <div className="row" style={{ marginTop: 8 }}>
            <div className="seg" role="group" aria-label="Which mode to edit">
              <button className={editing === 'light' ? 'on' : ''} onClick={() => setEditing('light')}>Light mode</button>
              <button className={editing === 'dark' ? 'on' : ''} onClick={() => setEditing('dark')}>Dark mode</button>
            </div>
            <label className="row">Start over from
              <select value={base} onChange={(e) => { const id = e.target.value as PaletteId; setBase(id); if (confirm(`Replace your colors with ${NAMES[id]}? Your saved themes are not affected.`)) startCustom(id); }}>
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
