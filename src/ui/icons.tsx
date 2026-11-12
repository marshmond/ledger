import type { ReactNode } from 'react';

/**
 * A very small set of line icons (inline SVG, no dependency, no image file) for the D6 shared components: status shapes, the empty-state
 * mark and the icon button. Only icons a shared component actually draws are here; this is not an application-wide icon replacement.
 *
 * Every icon is decoration: it is hidden from assistive technology, and the words beside it (or an aria-label on the button that holds it)
 * carry the meaning. A status is therefore never told by an icon or a colour alone.
 */
export type IconName = 'check' | 'alert' | 'warning' | 'info' | 'dot' | 'wave' | 'help' | 'inbox' | 'close' | 'plus' | 'search' | 'chevron-down' | 'sliders';

const SHAPES: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.2M12 16.3v.2" /></>,
  warning: <><path d="M12 4 21 19.5H3Z" /><path d="M12 10v4.2M12 16.9v.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.2M12 7.8v.2" /></>,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" />,
  wave: <path d="M3.5 9.5c2-2.4 4-2.4 6 0s4 2.4 6 0 3-2 5-.2M3.5 15.5c2-2.4 4-2.4 6 0s4 2.4 6 0 3-2 5-.2" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8M12 16.8v.2" /></>,
  inbox: <><path d="M4 13.5 6.5 5h11L20 13.5" /><path d="M4 13.5h4.2l1 2.3h5.6l1-2.3H20V19H4Z" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  // D7 (global header): search, the switcher's chevron and Settings (the same sliders mark the D3 prototypes use).
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
};

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ui-icon ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {SHAPES[name]}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(SHAPES) as IconName[];
