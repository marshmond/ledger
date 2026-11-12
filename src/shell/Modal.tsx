import { useEffect, useRef, type ReactNode } from 'react';
import { attachModal } from './modalKeys';
import { useSheetBehavior } from './sheetBehavior';

/**
 * A simple dialog: dims the page, closes on Escape or a click outside, and returns focus to where it came from.
 * `variant="sheet"` (opt-in; Quick Add uses it since D10): on a phone-width screen the dialog rises from the bottom edge as a sheet, and wider screens show the ordinary
 * dialog. Keys, focus and closing are the same as for any dialog. A sheet also follows the visible area when the on-screen keyboard opens and keeps the page behind it
 * from scrolling on a touch screen (see `sheetBehavior.ts`); a plain dialog does neither. `className` adds one class to the dialog box (default: none).
 */
export default function Modal({ title, onClose, children, wide = false, variant = 'dialog', className }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; variant?: 'dialog' | 'sheet'; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the effect (which would steal focus from the field being typed in).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Where focus was before this dialog drew (an autofocused field inside has taken it by the time the effect runs).
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => attachModal(document as never, box.current as never, () => closeRef.current(), opener.current), []);
  useSheetBehavior(back, variant === 'sheet');
  return (
    <div ref={back} className={`modal-back${variant === 'sheet' ? ' modal-back--sheet' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className={`modal ${wide ? 'wide' : ''}${variant === 'sheet' ? ' modal--sheet' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div className="row spread modal-head">
          <strong>{title}</strong>
          <button className="link" onClick={() => closeRef.current()} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
