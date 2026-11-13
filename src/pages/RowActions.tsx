import { useEffect, useRef, type ReactNode } from 'react';
import { useMediaQuery } from '../ui/useMediaQuery';

/**
 * The actions on one transaction row (D16 mobile refinement). Presentation only: the buttons arrive as children from the page, with their own handlers and
 * their own long accessible names, and nothing here wraps, delays or replaces a handler. On a computer the buttons are laid out in a row exactly as before.
 * On a phone they sit behind ONE labeled "Actions" button on the row, so a long register is not a column of repeated links:
 *  - it is a native <details>/<summary>, so touch, Enter and Space all work and the open state is announced;
 *  - the summary's name says which row it belongs to ("Actions for Demo Market, 2026-11-06");
 *  - Escape closes it and puts focus back on the summary; tapping or clicking elsewhere closes it;
 *  - nothing closes it by itself when an action is chosen, so Delete's own confirmation dialog still opens from, and returns focus to, a visible button.
 * The choose-then-confirm safeguards (the delete dialog, the reconciled-entry warnings in the form) are unchanged and still required.
 */
export function RowActionsView({ phone, label, children, detailsRef }: { phone: boolean; label: string; children: ReactNode; detailsRef?: React.Ref<HTMLDetailsElement> }) {
  if (!phone) return <div className="mny-rowact">{children}</div>;
  return (
    <details
      ref={detailsRef}
      className="mny-act"
      onKeyDown={(e) => {
        const d = e.currentTarget;
        if (e.key === 'Escape' && d.open) {
          e.stopPropagation();
          d.open = false;
          d.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label={`Actions for ${label}`}>Actions</summary>
      <div className="mny-act-menu" role="group" aria-label={`Actions for ${label}`}>{children}</div>
    </details>
  );
}

export default function RowActions({ label, children }: { label: string; children: ReactNode }) {
  const phone = useMediaQuery('(max-width: 640px)');
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!phone) return;
    const close = (e: Event) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [phone]);
  return <RowActionsView phone={phone} label={label} detailsRef={ref}>{children}</RowActionsView>;
}
