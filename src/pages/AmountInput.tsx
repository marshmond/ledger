import { useEffect, useRef, type CSSProperties } from 'react';
import { centsText, keypadText, useKeypadAmounts } from '../lib/amountEntry';
import { parseAmountToCents } from '../lib/money';

/**
 * A dollar amount box for the transaction forms. Normally typing works as usual; with keystroke-style entry on (the default,
 * switchable in Settings) digits shift in from the right, so 1, 2, 4, 5 shows 0.01, 0.12, 1.24, 12.45. The value is plain
 * text such as "12.45" either way, so the forms read it as before. Pasting a whole amount (12.45, $1,200.50) always works.
 */
export default function AmountInput({
  value,
  onChange,
  className,
  style,
  placeholder = '0.00',
  onEnter,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  onEnter?: () => void;
  label?: string;
}) {
  const keypad = useKeypadAmounts();
  const ref = useRef<HTMLInputElement>(null);

  // Digits always go on the end, so keep the cursor there.
  useEffect(() => {
    const el = ref.current;
    if (keypad && el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
  }, [value, keypad]);

  const toEnd = () => {
    const el = ref.current;
    if (keypad && el) el.setSelectionRange(el.value.length, el.value.length);
  };

  return (
    <input
      ref={ref}
      className={className}
      style={style}
      inputMode={keypad ? 'numeric' : 'decimal'}
      placeholder={placeholder}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(keypad ? keypadText(e.target.value) : e.target.value)}
      onPaste={(e) => {
        if (!keypad) return;
        e.preventDefault();
        const cents = parseAmountToCents(e.clipboardData.getData('text'));
        if (cents !== null) onChange(centsText(cents));
      }}
      onFocus={() => setTimeout(toEnd, 0)}
      onClick={toEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
    />
  );
}
