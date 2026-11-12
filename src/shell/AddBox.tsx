import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPEN_ADD_EVENT, type AddBoxRequest } from '../core/globalEvents';
import { routeQuickAdd } from '../core/quickAddRoute';
import { allModules, allQuickAdds, type QuickAddPreview } from '../core/registry';
import { ToastProvider, useToast } from '../ui/Toast';
import { feedbackKind, layoutDestinations, orderDestinations, primaryAction, resolveDestination, shortcutHint, showsInput } from './addBoxModel';
import AddBoxView from './AddBoxView';
import Modal from './Modal';

/**
 * The one Add box for the whole app (opened by the "+" / Add button, or by `openAddBox`). You choose what you are adding (Task, Event,
 * Transaction, Scheduled payment and the rest) with the buttons, or start the text with a shortcut (`t `, `e `, `$ `, `b ` or the whole word).
 * It never guesses: without a choice it asks. Before anything is saved it shows "Will add: ..." with how the words were understood;
 * Cancel, Esc and clicking outside save nothing. Each module supplies its destination through `contributes.quickAdd`.
 *
 * D10: this file is the controller (state, routing, saving, opening); how it looks is `AddBoxView`, and how the destinations are arranged and labeled is
 * `addBoxModel`. It must never create, find or link a Contact: provider and person names stay as typed words, and Family member / Family date only open Family's own forms.
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
  // Phone only: whether every type is showing (the compact sheet shows the three cards and a button for the rest).
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const formId = `ab-${useId().replace(/:/g, '')}`;

  // The chooser always reads Task, Event, Transaction, Scheduled payment first; destinations from other modules follow in module order.
  const defs = orderDestinations(allQuickAdds());
  const { dest, body, routed } = useMemo(() => resolveDestination(defs, text, choice), [text, choice, defs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: Event) => {
      const req = (e as CustomEvent<AddBoxRequest>).detail ?? {};
      setText(req.text ?? '');
      setChoice(req.dest ?? null);
      setPlain(false);
      setError('');
      setBusy(false);
      setExpanded(false);
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
    setExpanded(false); // on a phone, show the result of the choice rather than the long list
  };
  const clear = () => { setText(body); setChoice(null); setError(''); };
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
  const layout = layoutDestinations(defs, allModules());
  const primary = primaryAction({ dest, preview, busy });

  // A form or another screen is shown under the command field in the destination's own words (nothing is saved by the box itself).
  const panel = dest?.Form ? (
    <div className="ab-formbox">
      <p className="ab-ask">Will add: <strong>a transaction</strong>. Fill in the details, then Save.</p>
      <dest.Form onDone={close} />
    </div>
  ) : dest?.open ? (
    <div className="ab-formbox">
      <p className="ab-ask">Will add: <strong>{dest.openCopy?.what ?? `a ${dest.label.toLowerCase()}`}</strong>. {dest.openCopy?.where ?? 'It is set up on its own screen.'}</p>
    </div>
  ) : null;

  return (
    <Modal title="Add" onClose={close} variant="sheet" className="ab-modal">
      <AddBoxView
        layout={layout}
        destId={dest?.id ?? null}
        dest={dest}
        showInput={showsInput(dest)}
        value={dest ? body : text}
        inputRef={input}
        inputLabel={dest ? `New ${dest.label.toLowerCase()}` : 'What do you want to add?'}
        placeholder={dest?.id === 'event' ? 'e.g. lunch with sam fri 12-1pm' : dest?.id === 'task' ? 'e.g. pay contractor fri !high #renovation +kitchen' : 'Type here, or pick a type below'}
        feedback={feedbackKind({ dest, text, body, preview })}
        hint={shortcutHint(layout)}
        preview={preview}
        plain={plain}
        panel={panel}
        error={error}
        primary={primary}
        formId={formId}
        expanded={expanded}
        onInput={(e) => {
          // A shortcut typed at the start picks the destination and is removed from the box; the choice then sticks while you keep typing.
          const v = e.target.value;
          const r = routeQuickAdd(v, defs);
          if (r.def) { setChoice(r.def.id); setText(r.rest); } else { if (dest) setChoice(dest.id); setText(v); }
        }}
        onSubmit={(e) => { e.preventDefault(); void add(); }}
        onPick={pick}
        onClear={clear}
        onPlain={setPlain}
        onPrimary={() => { if (dest?.open) { close(); dest.open({ navigate: nav }); } }}
        onCancel={close}
        onToggleAll={() => setExpanded((x) => !x)}
        onGo={(to) => { close(); nav(to); }}
      />
    </Modal>
  );
}
