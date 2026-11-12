import type { ChangeEvent, FormEvent, ReactNode, RefObject } from 'react';
import type { QuickAddDef, QuickAddPreview } from '../core/registry';
import { Icon } from '../ui/icons';
import { destIcon, SPECIAL_ACTIONS, type FeedbackKind, type Layout, type Primary } from './addBoxModel';

/**
 * D10: how the Add box LOOKS. This component draws what `AddBox` (the controller) hands it and reports clicks back; it owns no state, parses nothing, saves nothing and
 * imports no module code, so the layout can be tested by rendering it with plain props. Everything that happens (routing a typed shortcut, the preview, saving, opening a
 * form, closing) stays in `AddBox` and in each destination's own definition.
 *
 * Layout: the command field first (the chosen type shows as a token inside it), the line that says what will be added, three large cards, the other types in
 * groups, and a footer with Cancel and one primary button. On a phone the groups are folded behind an "All types" button until it is pressed; on a wider screen
 * they are always shown (the stylesheet decides; the markup is the same).
 */
type Def = QuickAddDef & { moduleId?: string };

export interface AddBoxViewProps {
  layout: Layout<Def>;
  /** The chosen destination's id, or null. */
  destId: string | null;
  dest: Def | null;
  /** Whether the text field is drawn (not for a form or another screen). */
  showInput: boolean;
  /** What is in the field (the shortcut is already removed when a destination is chosen). */
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  inputLabel: string;
  placeholder: string;
  feedback: FeedbackKind;
  /** The shortcuts of the featured types, for the hint lines. */
  hint: string;
  preview: QuickAddPreview | null;
  plain: boolean;
  /** For a form or another screen: what is shown under the command field (the controller supplies it, so each destination keeps its own wording). */
  panel: ReactNode;
  error: string;
  primary: Primary;
  /** The id of the form the primary button submits (the field's own form, so Enter and the button do the same thing). */
  formId: string;
  /** Phone only: are all the groups showing? */
  expanded: boolean;
  onInput(e: ChangeEvent<HTMLInputElement>): void;
  onSubmit(e: FormEvent): void;
  onPick(id: string): void;
  onClear(): void;
  onPlain(v: boolean): void;
  onPrimary(): void;
  onCancel(): void;
  onToggleAll(): void;
  onGo(to: string): void;
}

export default function AddBoxView(p: AddBoxViewProps) {
  const groupsId = `${p.formId}-groups`;
  const others = p.layout.groups.reduce((n, g) => n + g.defs.length, 0);

  const typeButton = (d: Def) => (
    <button key={d.id} type="button" className={`ab-chip${p.destId === d.id ? ' on' : ''}`} aria-pressed={p.destId === d.id} onClick={() => p.onPick(d.id)}>
      <Icon name={destIcon(d.id)} size={17} className="ab-ico" />
      <span className="ab-chip-label">{d.label}</span>
      <span className="ab-key" aria-hidden="true">{d.prefix}</span>
    </button>
  );

  return (
    <div className="ab" data-expanded={p.expanded ? 'true' : 'false'} data-kind={p.dest ? (p.dest.parse ? 'text' : p.dest.Form ? 'form' : 'open') : 'none'}>
      <form id={p.formId} className={`ab-cmd${p.dest ? ' ab-cmd--tok' : ''}`} role="group" aria-label="Command" onSubmit={p.onSubmit}>
        {p.dest ? (
          <span className="ab-tok">
            <Icon name={destIcon(p.dest.id)} size={16} />
            <span>{p.dest.label}</span>
            <button type="button" className="ab-tok-x" aria-label={`Clear type: ${p.dest.label}`} onClick={p.onClear}><Icon name="close" size={14} /></button>
          </span>
        ) : <span className="ab-cmd-ico"><Icon name="command" size={18} /></span>}
        {p.showInput ? (
          <input ref={p.inputRef} className="ab-input" value={p.value} onChange={p.onInput} aria-label={p.inputLabel} placeholder={p.placeholder} autoComplete="off" autoFocus />
        ) : (
          <span className="ab-cmd-note">{p.dest?.Form ? 'Details are filled in below' : 'Opens on its own screen'}</span>
        )}
        {p.showInput && <span className="ab-ret" aria-hidden="true"><kbd>Enter</kbd></span>}
      </form>

      <div className="ab-body">
        {p.feedback === 'ask' && <p className="ab-hint ab-ask" role="status">What kind of thing is this? Pick a type below, or start the line with a shortcut ({p.hint}).</p>}
        {p.feedback === 'choose' && <p className="ab-hint">Pick a type below, or start the line with a shortcut: {p.hint}.</p>}
        {p.feedback === 'type' && p.dest && <p className="ab-hint">Type the {p.dest.label.toLowerCase()} and press Enter. You will see what will be added before it is saved.</p>}
        {(p.feedback === 'preview' || p.feedback === 'nothing') && (
          <div className="ab-preview" aria-live="polite">
            {p.preview ? (
              <>
                <p>Will add: <strong>{p.preview.summary}</strong></p>
                <p className="ab-fields">{p.preview.fields.map((f, i) => <span key={i} className="ab-pill">{f.label ? `${f.label}: ` : ''}{f.value}</span>)}</p>
              </>
            ) : <p className="muted">Nothing to add yet.</p>}
            <label className="ab-plain"><input type="checkbox" checked={p.plain} onChange={(e) => p.onPlain(e.target.checked)} /> Use as plain title</label>
          </div>
        )}
        {p.feedback === 'panel' && p.panel}
        {p.error && <p className="error" role="alert">{p.error}</p>}

        <div className="ab-sec" id={`${p.formId}-common`}>Choose a type</div>
        <div className="ab-prim" role="group" aria-labelledby={`${p.formId}-common`}>
          {p.layout.featured.map(({ def, sub }) => (
            <button key={def.id} type="button" className={`ab-card${p.destId === def.id ? ' on' : ''}`} aria-pressed={p.destId === def.id} onClick={() => p.onPick(def.id)}>
              <span className="ab-card-ico"><Icon name={destIcon(def.id)} size={21} /></span>
              <span className="ab-card-tx">
                <span className="ab-card-name">{def.label} <span className="ab-key" aria-hidden="true">{def.prefix}</span></span>
                <span className="ab-card-sub">{sub}</span>
              </span>
              <Icon name="check" size={16} className="ab-tick" />
            </button>
          ))}
        </div>

        <button type="button" className="ab-more" aria-expanded={p.expanded} aria-controls={groupsId} onClick={p.onToggleAll}>
          <span className="ab-more-tx">
            <span className="ab-more-name">{p.expanded ? 'Fewer types' : 'All types'}</span>
            <span className="ab-more-sub">Household, family, bills, scheduled payments and more</span>
          </span>
          {!p.expanded && <span className="ab-more-cnt">{others} more</span>}
          <Icon name={p.expanded ? 'chevron-up' : 'chevron-down'} size={20} />
        </button>

        <div id={groupsId} className="ab-groups">
          <div className="ab-sec ab-sec--more">More types</div>
          {p.layout.groups.map((g) => (
            <section key={g.key} className="ab-grp" aria-labelledby={`${p.formId}-g-${g.key}`}>
              <h3 id={`${p.formId}-g-${g.key}`}><Icon name={g.icon} size={16} />{g.label}</h3>
              <div className="ab-chips">{g.defs.map(typeButton)}</div>
              {g.key === 'finances' && <SpecialRow onGo={p.onGo} />}
            </section>
          ))}
          {!p.layout.groups.some((g) => g.key === 'finances') && (
            <section className="ab-grp ab-grp--bare" aria-label="Opens another screen"><div className="ab-chips"><SpecialRow onGo={p.onGo} bare /></div></section>
          )}
        </div>
      </div>

      <div className="ab-foot">
        <span className="ab-foot-hint"><kbd>N</kbd> opens Add anywhere</span>
        <span className="ab-foot-gap" />
        <button type="button" className="ab-cancel" onClick={p.onCancel}>Cancel</button>
        {p.primary.kind === 'submit' && <button type="submit" form={p.formId} className="btn primary ab-primary" disabled={p.primary.disabled} aria-busy={p.primary.label === 'Adding…'}>{p.primary.label}</button>}
        {p.primary.kind === 'open' && <button type="button" className="btn primary ab-primary" onClick={p.onPrimary}>{p.primary.label}</button>}
      </div>
    </div>
  );
}

/** Log a trade and New paycheck scenario: dashed, with an arrow, under the Finances types, so they read as "go to another screen" rather than "create something here". */
function SpecialRow({ onGo, bare = false }: { onGo(to: string): void; bare?: boolean }) {
  return (
    <div className={`ab-go${bare ? ' ab-go--bare' : ''}`} role="group" aria-labelledby="ab-go-note">
      <span className="ab-go-note" id="ab-go-note">Opens another screen</span>
      {SPECIAL_ACTIONS.map((a) => (
        <button key={a.id} type="button" className="ab-chip ab-chip--go" onClick={() => onGo(a.path)}>
          <Icon name={a.icon} size={17} className="ab-ico" />
          <span className="ab-chip-label">{a.label}</span>
          <Icon name="external" size={15} className="ab-ext" />
        </button>
      ))}
    </div>
  );
}
