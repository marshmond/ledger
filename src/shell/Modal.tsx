import { useEffect, useRef, type ReactNode } from 'react';
import { attachModal } from './modalKeys';

/**
 * A simple dialog: dims the page, closes on Escape or a click outside, and returns focus to where it came from.
 * `variant="sheet"` (D6, opt-in, used by nothing yet) only adds two class names: on a phone-width screen the dialog then rises from the bottom edge as a sheet. It changes no
 * behaviour (keys, focus, closing are the same), and wider screens show the ordinary dialog. Quick Add adopts it in D10.
 */
export default function Modal({ title, onClose, children, wide = false, variant = 'dialog' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; variant?: 'dialog' | 'sheet' }) {
  const box = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the effect (which would steal focus from the field being typed in).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Where focus was before this dialog drew (an autofocused field inside has taken it by the time the effect runs).
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => attachModal(document as never, box.current as never, () => closeRef.current(), opener.current), []);
  return (
    <div className={`modal-back${variant === 'sheet' ? ' modal-back--sheet' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className={`modal ${wide ? 'wide' : ''}${variant === 'sheet' ? ' modal--sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div className="row spread modal-head">
          <strong>{title}</strong>
          <button className="link" onClick={() => closeRef.current()} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
