import { useEffect, useRef, type ReactNode } from 'react';

/** A simple dialog: dims the page, closes on Escape or a click outside, and returns focus to where it came from. */
export default function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the effect (which would steal focus from the field being typed in).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    // A field inside may already have asked for focus; only take it if nothing in the dialog has it.
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div className="row spread modal-head">
          <strong>{title}</strong>
          <button className="link" onClick={() => closeRef.current()} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
