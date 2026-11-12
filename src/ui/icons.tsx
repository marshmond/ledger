import type { ReactNode } from 'react';

/**
 * A very small set of line icons (inline SVG, no dependency, no image file) for the D6 shared components: status shapes, the empty-state
 * mark and the icon button. Only icons a shared component actually draws are here; this is not an application-wide icon replacement.
 *
 * Every icon is decoration: it is hidden from assistive technology, and the words beside it (or an aria-label on the button that holds it)
 * carry the meaning. A status is therefore never told by an icon or a colour alone.
 */
export type IconName = 'check' | 'alert' | 'warning' | 'info' | 'dot' | 'wave' | 'help' | 'inbox' | 'close' | 'plus' | 'search' | 'chevron-down' | 'sliders'
  | 'task' | 'calendar' | 'wallet' | 'folder' | 'home' | 'chart' | 'repeat' | 'users' | 'gift' | 'box' | 'gear' | 'wrench' | 'receipt' | 'trend' | 'calc' | 'external' | 'chevron-up' | 'command';

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
  // D10 (Quick Add): the destination, group and navigation marks. Same family of line shapes as the D3.4 prototype.
  task: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  wallet: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4" /><path d="M3 7.5v10A2.5 2.5 0 0 0 5.5 20H20V9H5.5A2.5 2.5 0 0 1 3 7.5z" /><circle cx="16.5" cy="14.5" r="1.2" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />,
  home: <path d="m3 11 9-7.5 9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  repeat: <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.5 2.5 3.5 5.5" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="11" rx="2" /><path d="M12 9v11M3.5 13h17M12 9c-1.5-4-5.5-4-5.5-1.5S10 9 12 9zm0 0c1.5-4 5.5-4 5.5-1.5S14 9 12 9z" /></>,
  box: <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2 6.8 20.5l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  trend: <path d="M3 17l5.5-5.5 3.5 3.5L21 6M15 6h6v6" />,
  calc: <><rect x="4.5" y="3" width="15" height="18" rx="3" /><path d="M8 7.5h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  command: <path d="m5 8 4 4-4 4M12 17h7" />,
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
