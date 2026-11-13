import { useState, type CSSProperties } from 'react';
import { rovingIndex, rovingKeys } from '../ui/rovingKeys';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { COLOR_ROLES, PRESETS, CLASSIC, colorsOf, contrastNotes, isHex, loadPalette, savePalette, varsFor, withoutOptional, type Colors, type ColorKey, type PaletteChoice, type PaletteColors, type PaletteId } from '../palette';
import { LIMIT_MESSAGE, addTheme, atLimit, checkThemeName, decodeTheme, encodeTheme, newThemeId, parseThemes, renameTheme, sameColors, uniqueName, updateTheme, type SavedTheme } from '../lib/savedThemes';
import { removeStoredTheme } from '../lib/savedRemoval';
import ConfirmDialog from '../shell/ConfirmDialog';
import { applyTheme, loadTheme } from '../theme';
import ThemeToggle from './ThemeToggle';
import { PageHeader } from '../ui/components';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';

const NAMES: Record<PaletteId, string> = { classic: 'Classic blue', teal: 'Calm teal', navy: 'Deep navy and gold', forest: 'Forest green and stone', slate: 'Slate and indigo', signature: 'Ledger Signature', custom: 'My own colors' };
const BLURB: Record<string, string> = { classic: 'The original look: clean white and blue.', ...Object.fromEntries(PRESETS.map((p) => [p.id, p.blurb])), custom: 'Pick every color yourself, for light and dark.' };
/** A palette still being rolled out is labelled "preview" (set `preview` on its entry in src/palette.ts; removing the flag removes the label everywhere). */
const PREVIEW = new Set<PaletteId>(PRESETS.filter((p) => p.preview).map((p) => p.id));
const label = (id: PaletteId) => (PREVIEW.has(id) ? `${NAMES[id]} (preview)` : NAMES[id]);

const dots = (c: PaletteColors) => [c.page ?? c.bg, c.surface ?? c.card, c.accent, c.pos, c.neg, c.sideBg];

/** One row of the color map: a name, what it colors, a color picker, and the hex code. */
function ColorRow({ role, value, onChange }: { role: (typeof COLOR_ROLES)[number]; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const shown = isHex(text) ? text : value;
  return (
    <div className="colorrow">
      <input type="color" aria-label={`${role.label} color`} value={shown.toLowerCase()} onChange={(e) => { setText(e.target.value); onChange(e.target.value.toUpperCase()); }} />
      <div className="info">
        <strong>{role.label}</strong>
        <div className="muted se-role-help">{role.help}</div>
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
  // D20.1A: the saved theme whose "delete" was pressed, by id. Nothing is changed until the dialog's own Delete theme button is pressed.
  const [askDelete, setAskDelete] = useState<string | null>(null);

  const set = (c: PaletteChoice) => {
    setChoiceState(c);
    savePalette(c);
    applyTheme(loadTheme()); // re-applies the colors for the mode now in effect
  };
  // A palette of your own has the twelve colors in the map. Starting from a preset that also sets a separate canvas and card color (Signature) drops those two,
  // so "Page background" and "Cards and panels" in the map still change the whole page, as they always have.
  const baseColors = (id: PaletteId, dark: boolean): Colors => withoutOptional(colorsOf({ id, custom: choice.custom }, dark) ?? CLASSIC[dark ? 'dark' : 'light']);
  const custom = choice.id === 'custom' && choice.custom ? choice.custom : null;
  const current = custom ? custom[editing] : null;
  const notes = current ? contrastNotes(current) : [];
  const active = themes.find((t) => t.id === choice.savedId);
  const changed = !!active && !!custom && !sameColors(custom, active);
  const target = askDelete === null ? undefined : themes.find((t) => t.id === askDelete);

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

  const paletteIds = ['classic', ...PRESETS.map((p) => p.id), 'custom'] as PaletteId[];
  const inUse = (id: PaletteId) => (id === 'custom' ? choice.id === 'custom' && !active : choice.id === id);
  const nowName = active ? active.name : choice.id === 'custom' ? NAMES.custom : label(choice.id);

  return (
    <>
      <PageHeader title="Appearance" description="Light or dark, the color palette, and themes you have saved." />
      <p className="se-now" role="status">
        <span className="se-now-label">Colors right now</span>
        <strong className="se-now-value">{nowName}</strong>
      </p>

      <SettingsSection id="mode" title="Mode" badge={<Pill tone="quiet">This device only</Pill>}
        intro="Mode follows your phone or computer (Device), or you can force Light or Dark. Colors are chosen separately, below. Both are remembered on this device only, except your saved themes, which are kept with your data.">
        <div className="se-mode">
          <ThemeToggle />
          <ul className="se-points">
            <li><strong>Device</strong> follows the light or dark setting of your phone or computer.</li>
            <li><strong>Light</strong> and <strong>Dark</strong> stay as chosen, whatever the device does.</li>
            <li>The button cycles Device, Light, Dark. The same button is in the Ledger menu bar.</li>
          </ul>
        </div>
      </SettingsSection>

      <SettingsSection id="palettes" title="Color palettes" intro="Each card shows the palette in light (top row of dots) and dark (bottom row). Choose one to use it everywhere in Ledger.">
        <div className="pal-grid se-pals" role="radiogroup" aria-label="Color palette" onKeyDown={rovingKeys}>
          {paletteIds.map((id) => {
            const sample = id === 'custom' ? (custom?.light ?? CLASSIC.light) : id === 'classic' ? CLASSIC.light : PRESETS.find((p) => p.id === id)!.light;
            const sampleDark = id === 'custom' ? (custom?.dark ?? CLASSIC.dark) : id === 'classic' ? CLASSIC.dark : PRESETS.find((p) => p.id === id)!.dark;
            const on = inUse(id);
            return (
              <button key={id} role="radio" aria-checked={on} tabIndex={(on) ? 0 : -1} className={`pal ${on ? 'on' : ''}`} onClick={() => (id === 'custom' ? (custom ? set({ id: 'custom', custom }) : startCustom(base)) : set({ id }))}>
                <span className="se-pal-head"><strong>{label(id)}</strong>{on && <Pill tone="ok">In use</Pill>}</span>
                <span className="swatches" aria-hidden="true">{dots(sample).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                <span className="swatches" aria-hidden="true">{dots(sampleDark).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                <span className="muted se-pal-blurb">{BLURB[id]}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection id="themes" title="My themes" badge={<Pill tone="info">Synced with your data</Pill>}
        intro={themes.length === 0 ? 'Nothing saved yet. Choose “My own colors”, adjust the colors, and save them here with a name. Saved themes sync to your other devices.' : 'Colors you saved with a name. Choose one to use it; change it under “Your colors” below.'}>
        {themes.length > 0 && (
          <div className="pal-grid se-pals" role="radiogroup" aria-label="My saved themes" onKeyDown={rovingKeys}>
            {themes.map((t, i) => (
              <button key={t.id} role="radio" aria-checked={choice.savedId === t.id} tabIndex={rovingIndex(i, themes.findIndex((x) => x.id === choice.savedId))} className={`pal ${choice.savedId === t.id ? 'on' : ''}`} onClick={() => set({ id: 'custom', custom: { light: { ...t.light }, dark: { ...t.dark } }, savedId: t.id })}>
                <span className="se-pal-head"><strong>{t.name}</strong>{choice.savedId === t.id && <Pill tone="ok">In use</Pill>}</span>
                <span className="swatches" aria-hidden="true">{dots(t.light).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                <span className="swatches" aria-hidden="true">{dots(t.dark).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              </button>
            ))}
          </div>
        )}
        <details className="se-details">
          <summary>Add a theme from a code</summary>
          <p className="muted">Paste a theme code that was copied from another copy of the app.</p>
          <div className="row">
            <label className="f">Theme code<textarea rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} placeholder="ledger-theme-1:…" /></label>
            <button disabled={!pasted.trim()} onClick={importCode}>Add theme</button>
          </div>
        </details>
        {msg && <div className="muted se-msg" role="status">{msg}</div>}
      </SettingsSection>

      {choice.id === 'custom' && custom && current && (
        <SettingsSection id="editor" title={`Your colors${active ? `: ${active.name}` : ''}`}
          intro="Pick a color for each part of the app. Light and dark are set separately, so choose which one you are editing. Anything hard to read is flagged.">
          <div className="row se-actions">
            {active && changed && <Pill tone="warn">Changed, not saved</Pill>}
            {active && changed && <button className="primary" onClick={() => store(updateTheme(themes, active.id, custom))}>Update “{active.name}”</button>}
            <button onClick={() => openName('new')}>Save as new theme…</button>
            {active && <button className="link" onClick={() => openName('rename')}>rename</button>}
            {active && <button className="link" onClick={() => setAskDelete(active.id)}>delete</button>}
            <button className="link" onClick={copyCode}>copy theme code</button>
          </div>
          {naming && (
            <form className="row se-name" onSubmit={(e) => { e.preventDefault(); commitName(); }}>
              <label className="f">{naming === 'rename' ? 'New name' : 'Name for this theme'}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></label>
              <button className="primary" type="submit">Save</button>
              <button type="button" onClick={() => setNaming(null)}>Cancel</button>
              {err && <span className="error" role="alert">{err}</span>}
            </form>
          )}
          {code && <textarea className="se-code" readOnly rows={3} value={code} onFocus={(e) => e.currentTarget.select()} aria-label="Theme code" />}
          <div className="row se-editbar">
            <div className="seg" role="group" aria-label="Which mode to edit">
              <button className={editing === 'light' ? 'on' : ''} aria-pressed={editing === 'light'} onClick={() => setEditing('light')}>Light mode</button>
              <button className={editing === 'dark' ? 'on' : ''} aria-pressed={editing === 'dark'} onClick={() => setEditing('dark')}>Dark mode</button>
            </div>
            <label className="row">Start over from
              <select value={base} onChange={(e) => { const id = e.target.value as PaletteId; setBase(id); if (confirm(`Replace your colors with ${NAMES[id]}? Your saved themes are not affected.`)) startCustom(id); }}>
                {(['classic', ...PRESETS.map((p) => p.id)] as PaletteId[]).map((id) => <option key={id} value={id}>{label(id)}</option>)}
              </select>
            </label>
          </div>
          <div className="se-editor">
            <div>
              <SubHeading>Color map ({editing} mode)</SubHeading>
              <div className="colormap">
                {COLOR_ROLES.map((r) => <ColorRow key={`${editing}-${r.key}-${current[r.key]}`} role={r} value={current[r.key]} onChange={(hex) => update(r.key, hex)} />)}
              </div>
            </div>
            <div className="se-editor-side">
              <SubHeading>Readability check</SubHeading>
              {notes.length > 0 ? (
                <ul className="warn se-warn">{notes.map((n, i) => <li key={i}>{n.message} (contrast {n.ratio.toFixed(1)}, aim for {n.min} or more)</li>)}</ul>
              ) : <p className="muted small">Nothing hard to read in {editing} mode.</p>}
              <SubHeading>Preview ({editing} mode)</SubHeading>
              <div className="samples se-sample" style={varsFor(current) as CSSProperties}>
                <div className="se-sample-bar">
                  <strong>Ledger</strong>
                  <span className="on">Money</span>
                  <span>Invest</span>
                  <span>Plan</span>
                </div>
                <div className="sample-main">
                  <strong>Net worth</strong>
                  <div className="se-sample-fig">$412,350.00</div>
                  <div className="muted">Up <span className="pos">$12,400</span> this year, <span className="neg">$310</span> over budget, <span className="warn">backup due</span></div>
                  <div className="row se-sample-row">
                    <button className="primary">Primary</button>
                    <button>Secondary</button>
                    <a href="#/more" onClick={(e) => e.preventDefault()}>A link</a>
                  </div>
                  <div className="card se-sample-card">A card with some text.</div>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>
      )}

      {target && (
        <ConfirmDialog
          title="Delete saved theme?"
          confirmLabel="Delete theme"
          busyLabel="Deleting…"
          onCancel={() => setAskDelete(null)}
          onConfirm={async () => {
            // The list is read again now and only this id is taken out (see lib/savedRemoval.ts).
            await removeStoredTheme(db, target.id);
            // As before: if this theme was the one in use, its colors stay on as "My own colors" (no longer linked to a saved theme); nothing else about the colors changes.
            if (choice.savedId === target.id && custom) set({ id: 'custom', custom });
            setAskDelete(null);
          }}
        >
          <p><strong>{target.name}</strong></p>
          <p>The colors stay on until you pick something else. Your other saved themes and the built-in palettes are not changed. If you sync your devices, the theme is removed from them too.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
