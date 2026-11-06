import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { OPEN_SEARCH_EVENT, openAddBox } from '../core/globalEvents';
import { getModule } from '../core/registry';
import SearchDialog from './SearchDialog';

/**
 * True for a plain "N" press that should open the Add box: no Ctrl/Cmd/Alt, not held down, not while typing in a field, and not while
 * a dialog (the Add box itself, a form, search) is already open.
 */
export function wantsAddShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'defaultPrevented'>, typing: boolean, dialogOpen?: boolean): boolean {
  if (e.key !== 'n' && e.key !== 'N') return false;
  if (typing || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  return !(dialogOpen ?? !!document.querySelector('[aria-modal="true"]'));
}

/**
 * The parts of the shell that belong to the whole app, not to Ledger: the search dialog with its keyboard shortcuts (Ctrl/Cmd+K,
 * or "/" when not typing), the Add box shortcut ("N" when not typing), and the one rule for the bottom of a phone screen. Mounted once, next to the module bar.
 *
 * Bottom-bar rule: `--tab-h` is the height of the bottom tab bar when the current module has one (Ledger), else 0. The round "+" button
 * and the toasts are placed above it, so they sit at the screen's bottom edge in Calendar, Tasks and Today and above the tab bar in Ledger.
 */
export default function GlobalFrame() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || !!t?.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      } else if (wantsAddShortcut(e, typing)) {
        e.preventDefault();
        openAddBox();
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SEARCH_EVENT, onOpen); };
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);

  // Which module are we in? Its tab bar (if any) decides where the floating button and toasts sit.
  const moduleId = loc.pathname.split('/')[1];
  const tabbar = !!getModule(moduleId)?.hasTabBar;
  useEffect(() => {
    document.documentElement.dataset.tabbar = tabbar ? 'yes' : 'no';
    return () => { delete document.documentElement.dataset.tabbar; };
  }, [tabbar]);

  return open ? <SearchDialog onClose={() => setOpen(false)} /> : null;
}
