import { setKeypadEnabled, useKeypadAmounts } from '../lib/amountEntry';

/** The Settings switch for keystroke-style amounts in the transaction forms (this device only). */
export default function AmountEntryCard() {
  const on = useKeypadAmounts();
  return (
    <div className="card">
      <strong>Entering transaction amounts</strong>
      <label className="chk" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={on} onChange={(e) => setKeypadEnabled(e.target.checked)} />
        Type amounts without a decimal point
      </label>
      <p className="muted">
        With this on, the amount box in the transaction forms (add, edit, quick add, and splits) fills in from the right: typing 1, 2, 4, 5 shows 0.01, 0.12, 1.24,
        then 12.45, and Backspace takes off the last digit. Pasting a whole amount still works. Other money boxes in the app are not affected. This setting is for
        this device only.
      </p>
    </div>
  );
}
