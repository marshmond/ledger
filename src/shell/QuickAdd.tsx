import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openAddBox } from '../core/globalEvents';
import AddBox from './AddBox';

/** Anything can ask for the "add a transaction" form by sending this event (the command palette and page buttons do). It opens the Add box on Transaction. */
export const ADD_TXN_EVENT = 'ledger:add-transaction';
export const openAddTransaction = () => window.dispatchEvent(new Event(ADD_TXN_EVENT));

/**
 * The Add button, one for the whole app (mounted next to the module bar): an "Add" button in the module bar on a computer, a round
 * button on a phone. It opens the Add box (`AddBox`). The round button sits above Ledger's tab bar, or at the screen's bottom edge in
 * modules without one (see `--tab-h`).
 */
export default function QuickAdd() {
  const phone = usePhone();

  useEffect(() => {
    const open = () => openAddBox({ dest: 'transaction' });
    window.addEventListener(ADD_TXN_EVENT, open);
    return () => window.removeEventListener(ADD_TXN_EVENT, open);
  }, []);

  const button = (
    <div className="qa">
      <button className="qa-btn" aria-label="Quick add" title="Add (N)" aria-haspopup="dialog" onClick={() => openAddBox()}>
        <span className="qa-plus" aria-hidden="true">+</span>
        <span className="qa-label">Add</span>
      </button>
    </div>
  );

  return (
    <>
      {/* On a phone the round button is pinned to the screen; keeping it inside the sticky header makes some phone browsers nudge it while scrolling. */}
      {phone ? createPortal(button, document.body) : button}
      <AddBox />
    </>
  );
}

/** True below the width where the sidebar replaces the tab bar (same breakpoint as the stylesheet). */
function usePhone() {
  const query = '(max-width: 899px)';
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}
