import { forwardRef, useState, type FocusEventHandler } from 'react';

/**
 * A text box with an in-app suggestion list directly under it (the browser's own suggestion pop-up, `datalist`, can open far from the box).
 * Type to narrow the list; click a suggestion, or use the arrow keys and Enter. Escape closes the list. With nothing typed it offers the first few.
 */
const PayeeInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  onBlur?: FocusEventHandler<HTMLInputElement>;
}>(function PayeeInput({ value, onChange, options, placeholder, onBlur }, ref) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(-1);
  const q = value.trim().toLowerCase();
  const shown = open ? options.filter((o) => o.toLowerCase() !== q && (q === '' || o.toLowerCase().includes(q))).slice(0, 6) : [];
  const pick = (o: string) => { onChange(o); setOpen(false); setCur(-1); };

  return (
    <span className="payee-wrap">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setCur(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { setOpen(false); setCur(-1); onBlur?.(e); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); setCur((c) => Math.min(shown.length - 1, c + 1)); }
          else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); setCur((c) => Math.max(-1, c - 1)); }
          else if (e.key === 'Enter' && cur >= 0 && shown[cur]) { e.preventDefault(); e.stopPropagation(); pick(shown[cur]); }
          else if (e.key === 'Escape' && shown.length) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      {shown.length > 0 && (
        <ul className="payee-list" role="listbox">
          {shown.map((o, i) => (
            // mousedown (not click) so the box keeps focus and its own blur handling still runs afterwards
            <li key={o} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setCur(i)}>{o}</li>
          ))}
        </ul>
      )}
    </span>
  );
});

export default PayeeInput;
