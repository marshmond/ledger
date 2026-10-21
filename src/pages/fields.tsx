import { useState } from 'react';
import { parseAmountToCents } from '../lib/money';

/** A typed-in percent (min to max): any text is allowed while typing; the value is checked and kept within range when you click away. */
export function PercentField({
  label,
  value,
  min,
  max,
  onChange,
  width,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  const input = (
    <input
      style={{ width }}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onBlur={() => {
        const n = Number(text.trim());
        if (text.trim() === '' || !Number.isFinite(n)) return setText(String(value));
        const v = Math.min(max, Math.max(min, n));
        setText(String(v));
        if (v !== value) onChange(v);
      }}
    />
  );
  return label ? <label className="f">{label}{input}</label> : input;
}

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
