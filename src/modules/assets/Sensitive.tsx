import { useState } from 'react';

/**
 * A serial number, plate or address. Hidden until Show is pressed. The shown/hidden state is held here only: it is not stored, not synced,
 * and it hides again on reload or when you leave the page.
 */
export default function SensitiveValue({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = useState(false);
  if (!value) return null;
  return (
    <div className="as-fact">
      <dt>{label}</dt>
      <dd>
        {shown ? <span className="as-secret">{value}</span> : <span className="muted" aria-label={`${label} hidden`}>Hidden</span>}{' '}
        <button type="button" className="link" aria-pressed={shown} onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}<span className="sr-only"> {label}</span></button>
      </dd>
    </div>
  );
}
