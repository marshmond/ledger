import { useState, type CSSProperties } from 'react';
import { rovingIndex, rovingKeys } from '../ui/rovingKeys';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { COLOR_ROLES, PRESETS, colorsOf, contrastNotes, customVars, isHex, loadPalette, savePalette, varsOf, withoutOptional, type Colors, type ColorKey, type PaletteChoice, type PaletteId } from '../palette';
import { LIMIT_MESSAGE, addTheme, atLimit, checkThemeName, decodeTheme, encodeTheme, newThemeId, parseThemes, renameTheme, sameColors, uniqueName, updateTheme, type SavedTheme } from '../lib/savedThemes';
import { removeStoredTheme } from '../lib/savedRemoval';
import ConfirmDialog from '../shell/ConfirmDialog';
import { THEME_LABEL, applyTheme, loadTheme, saveTheme, type Theme } from '../theme';
import { PageHeader } from '../ui/components';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';

/** D21.1: Ledger has one interface, Ledger Signature. Palettes choose colors only, so there is no "old look" to pick: five palettes, saved themes, and "My own colors". */
const NAMES: Record<PaletteId, string> = { ...(Object.fromEntries(PRESETS.map((p) => [p.id, p.name])) as Record<string, string>), custom: 'My own colors' } as Record<PaletteId, string>;
const BLURB: Record<string, string> = { ...Object.fromEntries(PRESETS.map((p) => [p.id, p.blurb])), custom: 'Pick every color yourself, for light and dark.' };
const label = (id: PaletteId) => NAMES[id];

const MODES: { id: Theme; icon: string; hint: string }[] = [
  { id: 'light', icon: '☀', hint: 'Always light' },
  { id: 'dark', icon: '☾', hint: 'Always dark' },
  { id: 'device', icon: '◐', hint: 'Follows your phone or computer' },
];

/** The colors a small picture of the interface needs, read straight from the variables (the picture is a few shapes, not words). */
function Half({ vars, name }: { vars: Record<string, string>; name: string }) {
  return (
    <span className="pp-half" style={vars as CSSProperties}>
      <span className="pp-bar"><b /><i className="on" /><i /><i /></span>
      <span className="pp-page">
        <span className="pp-hero"><i /><i /></span>
        <span className="pp-card">
          <i className="t" /><i className="s" />
          <span className="pp-row"><u className="pos" /><u className="neg" /><u className="warn" /><em /></span>
        </span>
      </span>
      <span className="pp-cap">{name}</span>
    </span>
  );
}

/** A picture of one palette in Light (left) and Dark (right), drawn with that palette's own colors. Decoration: the card's name says everything. */
function PalettePreview({ light, dark }: { light: Record<string, string>; dark: Record<string, string> }) {
  return (
    <span className="pp" aria-hidden="true">
      <Half vars={light} name="Light" />
      <Half vars={dark} name="Dark" />
    </span>
  );
}

/** Light, Dark or Device: three radio buttons (the same choice as the button in the Ledger menu bar, which cycles through them). */
function ModePicker() {
  const [mode, setMode] = useState<Theme>(() => loadTheme());
  const choose = (t: Theme) => { saveTheme(t); applyTheme(t); setMode(t); };
  return (
    <div className="se-modes" role="radiogroup" aria-label="Appearance mode" onKeyDown={rovingKeys}>
      {MODES.map((m) => (
        <button key={m.id} role="radio" aria-checked={mode === m.id} tabIndex={mode === m.id ? 0 : -1} className={`se-mode-opt ${mode === m.id ? 'on' : ''}`} onClick={() => choose(m.id)}>
          <span className="se-mode-ic" aria-hidden="true">{m.icon}</span>
          <strong>{THEME_LABEL[m.id]}</strong>
          <span className="muted se-mode-hint">{m.hint}</span>
        </button>
      ))}
    </div>
  );
}

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
  const [base, setBase] = useState<PaletteId>(() => (choice.id === 'custom' ? 'signature-navy' : choice.id));
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
  // D20.1B (NC-08): the palette chosen under "Start over from", held until the dialog's own Replace colors button is pressed. The select (and the colors) are not touched before that.
  const [askBase, setAskBase] = useState<PaletteId | null>(null);

  const set = (c: PaletteChoice) => {
    setChoiceState(c);
    savePalette(c);
    applyTheme(loadTheme()); // re-applies the colors for the mode now in effect
  };
  // A palette of your own has the twelve colors in the map. A palette has a separate canvas and card color; starting from one puts the canvas in "Page background" and the card
  // color in "Cards and panels", so your colors begin as the same composition (and "Page background" in the map still changes the whole canvas, as it always has).
  const baseColors = (id: PaletteId, dark: boolean): Colors => {
    const c = colorsOf({ id, custom: choice.custom }, dark);
    return { ...withoutOptional(c), bg: c.page ?? c.bg, card: c.surface ?? c.card };
  };
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

  const paletteIds = [...PRESETS.map((p) => p.id), 'custom'] as PaletteId[];
  const inUse = (id: PaletteId) => (id === 'custom' ? choice.id === 'custom' && !active : choice.id === id);
  const nowName = active ? active.name : choice.id === 'custom' ? NAMES.custom : label(choice.id);
  /** Both modes of a palette as the variables its picture uses. "My own colors" with nothing chosen yet shows the palette it would start from. */
  const previewOf = (id: PaletteId) => {
    const c: PaletteChoice = id === 'custom' ? (custom ? { id: 'custom', custom } : { id: base }) : { id };
    return { light: varsOf(c, false), dark: varsOf(c, true) };
  };

  return (
    <>
      <PageHeader title="Appearance" description="Choose a color palette and Light, Dark or Device mode." />
      <p className="se-now" role="status">
        <span className="se-now-label">Colors right now</span>
        <strong className="se-now-value">{nowName}</strong>
      </p>

      <SettingsSection id="palettes" title="Color palette" badge={<Pill tone="quiet">This device only</Pill>}
        intro="Every palette gives Ledger the same layout; only the colors change. Each picture shows the palette in Light (left) and Dark (right).">
        <div className="pal-grid se-pals" role="radiogroup" aria-label="Color palette" onKeyDown={rovingKeys}>
          {paletteIds.map((id) => {
            const on = inUse(id);
            const pv = previewOf(id);
            return (
              <button key={id} role="radio" aria-checked={on} tabIndex={(on) ? 0 : -1} className={`pal ${on ? 'on' : ''}`} onClick={() => (id === 'custom' ? (custom ? set({ id: 'custom', custom }) : startCustom(base)) : set({ id }))}>
                <PalettePreview light={pv.light} dark={pv.dark} />
                <span className="se-pal-head"><strong>{label(id)}</strong>{on && <Pill tone="ok">In use</Pill>}</span>
                <span className="muted se-pal-blurb">{BLURB[id]}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection id="mode" title="Appearance mode" badge={<Pill tone="quiet">This device only</Pill>}
        intro="Light and Dark stay as chosen. Device follows the light or dark setting of your phone or computer. The same choice is the button in the Ledger menu bar. Your palette stays the same in every mode.">
        <ModePicker />
      </SettingsSection>

      <SettingsSection id="themes" title="My themes" badge={<Pill tone="info">Synced with your data</Pill>}
        intro={themes.length === 0 ? 'Nothing saved yet. Choose “My own colors”, adjust the colors, and save them here with a name. Saved themes sync to your other devices.' : 'Colors you saved with a name. Choose one to use it; change it under “Your colors” below.'}>
        {themes.length > 0 && (
          <div className="pal-grid se-pals" role="radiogroup" aria-label="My saved themes" onKeyDown={rovingKeys}>
            {themes.map((t, i) => (
              <button key={t.id} role="radio" aria-checked={choice.savedId === t.id} tabIndex={rovingIndex(i, themes.findIndex((x) => x.id === choice.savedId))} className={`pal ${choice.savedId === t.id ? 'on' : ''}`} onClick={() => set({ id: 'custom', custom: { light: { ...t.light }, dark: { ...t.dark } }, savedId: t.id })}>
                <span className="se-pal-head"><strong>{t.name}</strong>{choice.savedId === t.id && <Pill tone="ok">In use</Pill>}</span>
                <PalettePreview light={customVars(t.light, false)} dark={customVars(t.dark, true)} />
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
              <select value={base} onChange={(e) => setAskBase(e.target.value as PaletteId)}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
              <div className="samples se-sample" style={customVars(current, editing === 'dark') as CSSProperties}>
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

      {askBase && (
        <ConfirmDialog
          title="Replace your colors?"
          confirmLabel="Replace colors"
          busyLabel="Replacing…"
          tone="primary"
          kind="replace"
          onCancel={() => setAskBase(null)}
          // The select keeps showing the palette you were on until this button is pressed, so cancelling leaves both the colors and the label as they were.
          onConfirm={() => { setBase(askBase); startCustom(askBase); setAskBase(null); }}
        >
          <p>Replace your colors with <strong>{NAMES[askBase]}</strong>?</p>
          <p>Your saved themes are not affected.{active && changed ? ` Changes you made to “${active.name}” that are not saved yet are lost.` : ''}</p>
        </ConfirmDialog>
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
