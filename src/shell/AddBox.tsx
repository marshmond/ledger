import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPEN_ADD_EVENT, type AddBoxRequest } from '../core/globalEvents';
import { routeQuickAdd } from '../core/quickAddRoute';
import { allQuickAdds, type QuickAddPreview } from '../core/registry';
import { ToastProvider, useToast } from '../ui/Toast';
import Modal from './Modal';

/**
 * The one Add box for the whole app (opened by the "+" / Add button, or by `openAddBox`). You choose what you are adding (Task, Event,
 * Transaction, Scheduled payment) with the buttons, or start the text with a shortcut (`t `, `e `, `$ `, `b ` or the whole word).
 * It never guesses: without a choice it asks. Before anything is saved it shows "Will add: ..." with how the words were understood;
 * Cancel, Esc and clicking outside save nothing. Each module supplies its destination through `contributes.quickAdd`.
 */
export default function AddBox() {
  return (
    <ToastProvider>
      <AddBoxInner />
    </ToastProvider>
  );
}

function AddBoxInner() {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [plain, setPlain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // The chooser always reads Task, Event, Transaction, Scheduled payment; destinations from future modules follow in module order.
  const ORDER = ['task', 'event', 'transaction', 'scheduled'];
  const defs = allQuickAdds().sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
  const routed = useMemo(() => routeQuickAdd(text, defs), [text, defs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const dest = routed.def ?? defs.find((d) => d.id === choice) ?? null;
  const body = routed.def ? routed.rest : text;

  useEffect(() => {
    const h = (e: Event) => {
      const req = (e as CustomEvent<AddBoxRequest>).detail ?? {};
      setText(req.text ?? '');
      setChoice(req.dest ?? null);
      setPlain(false);
      setError('');
      setOpen(true);
    };
    window.addEventListener(OPEN_ADD_EVENT, h);
    return () => window.removeEventListener(OPEN_ADD_EVENT, h);
  }, []);

  // Let destinations learn about existing calendars, lists and tags while the box is open.
  useEffect(() => {
    if (!open) return;
    const stops = allQuickAdds().map((d) => { try { return d.start?.() ?? (() => undefined); } catch { return () => undefined; } });
    return () => stops.forEach((stop) => { try { stop(); } catch { /* nothing to tidy */ } });
  }, [open]);

  // The cursor starts in the text box, and returns to it when a choice is made (a button click would otherwise keep the focus).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, dest?.id, choice]);

  const preview: QuickAddPreview | null = useMemo(() => {
    if (!open || !dest?.parse || !body.trim()) return null;
    try { return dest.parse(body, { plain }); } catch { return null; }
  }, [open, dest, body, plain]);

  const close = () => { setOpen(false); setBusy(false); };
  const pick = (id: string) => {
    // Wrong shortcut typed? Choosing another destination swaps the shortcut for the choice and keeps the words.
    setText(routed.def ? routed.rest : text);
    setChoice(id);
    setError('');
  };
  const add = async () => {
    if (!dest?.commit || !preview || busy) return;
    setBusy(true);
    setError('');
    try {
      const undo = await dest.commit(preview);
      toast(`Added: ${preview.summary}`, typeof undo === 'function' ? undo : undefined);
      close();
    } catch (e) {
      setBusy(false);
      setError(`Could not save that: ${e instanceof Error ? e.message : 'something went wrong'}. Nothing was added.`);
    }
  };

  if (!open) return null;
  const shortcuts = defs.map((d) => `${d.prefix} ${d.label.toLowerCase()}`).join(' · ');
  const textual = !!dest?.parse;

  return (
    <Modal title="Add" onClose={close} wide>
      <div className="ab-chooser" role="group" aria-label="What are you adding?">
        {defs.map((d) => (
          <button key={d.id} type="button" className={`ab-chip${dest?.id === d.id ? ' on' : ''}`} aria-pressed={dest?.id === d.id} onClick={() => pick(d.id)}>
            {d.label} <span className="ab-key" aria-hidden="true">{d.prefix}</span>
          </button>
        ))}
      </div>

      {(!dest || textual) && (
        <form className="ab-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="row grow">
            <input
              ref={input}
              value={dest ? body : text}
              onChange={(e) => {
                // A shortcut typed at the start picks the destination and is removed from the box; the choice then sticks while you keep typing.
                const v = e.target.value;
                const r = routeQuickAdd(v, defs);
                if (r.def) { setChoice(r.def.id); setText(r.rest); } else { if (dest) setChoice(dest.id); setText(v); }
              }}
              aria-label={dest ? `New ${dest.label.toLowerCase()}` : 'What do you want to add?'}
              placeholder={dest?.id === 'event' ? 'e.g. lunch with sam fri 12-1pm' : dest?.id === 'task' ? 'e.g. pay contractor fri !high #renovation +kitchen' : 'Type here, or pick a button above'}
              autoComplete="off"
              autoFocus
            />
            <button type="submit" className="btn primary" disabled={!preview || busy}>Add</button>
          </div>
        </form>
      )}

      {!dest && text.trim() !== '' && (
        <p className="ab-ask" role="status">What kind of thing is this? Pick one above, or start the line with a shortcut ({shortcuts}).</p>
      )}
      {!dest && text.trim() === '' && <p className="muted small">Pick what you are adding, or type a shortcut first: {shortcuts}.</p>}

      {textual && body.trim() !== '' && (
        <div className="ab-preview" aria-live="polite">
          {preview ? (
            <>
              <p>Will add: <strong>{preview.summary}</strong></p>
              <p className="ab-fields">{preview.fields.map((f, i) => <span key={i} className="ab-pill">{f.label ? `${f.label}: ` : ''}{f.value}</span>)}</p>
            </>
          ) : <p className="muted">Nothing to add yet.</p>}
          <label className="ab-plain"><input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> Use as plain title</label>
        </div>
      )}
      {textual && body.trim() === '' && dest && <p className="muted small">Type the {dest.label.toLowerCase()} and press Enter. You will see what will be added before it is saved.</p>}

      {dest?.Form && (
        <div className="ab-formbox">
          <p className="ab-ask">Will add: <strong>a transaction</strong>. Fill in the details, then Save.</p>
          <dest.Form onDone={close} />
        </div>
      )}
      {dest?.open && (
        <div className="ab-formbox">
          <p className="ab-ask">Will add: <strong>{dest.openCopy?.what ?? `a ${dest.label.toLowerCase()}`}</strong>. {dest.openCopy?.where ?? 'It is set up on its own screen.'}</p>
          <button type="button" className="btn primary" onClick={() => { close(); dest.open!({ navigate: nav }); }}>{dest.openCopy?.button ?? 'Open the form'}</button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="ab-foot">
        <button type="button" className="link" onClick={() => { close(); nav('/ledger/investments'); }}>Log a trade</button>
        <button type="button" className="link" onClick={() => { close(); nav('/ledger/paycheck'); }}>New paycheck scenario</button>
        <span className="grow" />
        <button type="button" onClick={close}>Cancel</button>
      </div>
    </Modal>
  );
}
