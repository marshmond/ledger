import { useEffect, useId, useRef, type ReactNode } from 'react';
import { attachModal, guardedClose } from './modalKeys';
import { useSheetBehavior } from './sheetBehavior';

/**
 * A simple dialog: dims the page, closes on Escape or a click outside, and returns focus to where it came from.
 * `variant="sheet"` (opt-in; Quick Add uses it since D10): on a phone-width screen the dialog rises from the bottom edge as a sheet, and wider screens show the ordinary
 * dialog. Keys, focus and closing are the same as for any dialog. A sheet also keeps the page behind it from scrolling on a touch screen (see `sheetBehavior.ts`).
 * D20: EVERY dialog now follows the visible area when the on-screen keyboard opens (so a tall form can still be scrolled to its last field); only a sheet locks the page scroll.
 * Optional, all defaulting to the previous behaviour:
 *  - `size`: 'sm' (a short question), 'md' (the default, a standard form), 'lg' (a form with several sections; the same as `wide`).
 *  - `description`: one line under the title that assistive technology reads as the dialog's description.
 *  - `locked`: while true, Escape, a click outside and the close button do nothing (a save is running; closing then would leave the result unclear).
 * `className` adds one class to the dialog box (default: none).
 */
export default function Modal({ title, onClose, children, wide = false, size, variant = 'dialog', className, description, locked = false }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; size?: 'sm' | 'md' | 'lg'; variant?: 'dialog' | 'sheet'; className?: string; description?: string; locked?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const descId = useId();
  // Keep the latest onClose and lock without re-running the effect (which would steal focus from the field being typed in).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const close = guardedClose(() => lockedRef.current, () => closeRef.current());
  // Where focus was before this dialog drew (an autofocused field inside has taken it by the time the effect runs).
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => attachModal(document as never, box.current as never, guardedClose(() => lockedRef.current, () => closeRef.current()), opener.current), []);
  useSheetBehavior(back, true, variant === 'sheet');
  const big = wide || size === 'lg';
  return (
    <div ref={back} className={`modal-back${variant === 'sheet' ? ' modal-back--sheet' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${big ? 'wide' : ''}${size === 'sm' && !big ? ' modal--sm' : ''}${variant === 'sheet' ? ' modal--sheet' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-describedby={description ? descId : undefined} aria-busy={locked || undefined} ref={box} tabIndex={-1}>
        <div className="row spread modal-head">
          <strong>{title}</strong>
          <button className="link" onClick={close} disabled={locked} aria-label="Close">✕</button>
        </div>
        {description && <p id={descId} className="ui-modal-desc">{description}</p>}
        {children}
      </div>
    </div>
  );
}
