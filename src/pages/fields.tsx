import { useState } from 'react';
import { parseAmountToCents } from '../lib/money';

/** A dollars input that commits integer cents on blur and shows a hint if the text is not a valid amount. */
export function MoneyField({
  label,
  cents,
  onChange,
  width,
}: {
  label?: string;
  cents: number;
  onChange: (cents: number) => void;
  width?: number;
}) {
  const fmt = (c: number) => (c ? (c / 100).toFixed(2) : '');
  const [text, setText] = useState(fmt(cents));
  const [bad, setBad] = useState(false);
  const input = (
    <input
      style={{ width }}
      inputMode="decimal"
      placeholder="0.00"
      value={text}
      aria-invalid={bad}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const c = text.trim() === '' ? 0 : parseAmountToCents(text);
        if (c === null) return setBad(true);
        setBad(false);
        setText(fmt(c));
        if (c !== cents) onChange(c);
      }}
    />
  );
  return label ? (
    <label className="f">
      {label}
      {input}
      {bad && <span className="error">Not a valid amount</span>}
    </label>
  ) : (
    <>{input}{bad && <span className="error">?</span>}</>
  );
}

export function NumField({
  label,
  value,
  onChange,
  step,
  width,
}: {
  label?: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  width?: number;
}) {
  const input = (
    <input
      style={{ width }}
      type="number"
      step={step ?? 'any'}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
  return label ? <label className="f">{label}{input}</label> : input;
}
