import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SyncChip from './SyncChip';
import QuickAdd from '../shell/QuickAdd';
import { openSearch } from './globalEvents';
import { allModules, getModule, lastModuleId } from './registry';

/**
 * The thin bar across the top of every screen: which module you are in (with a switcher), and the shared Settings.
 *
 * Accessibility: the bar is a `nav` landmark named "Modules and tools". The switcher is a plain disclosure (a button that shows or hides
 * a list of links), not an ARIA "menu": a menu promises arrow-key movement, and these are ordinary links you reach with Tab.
 * Escape closes the list and puts focus back on the button.
 */
export default function ModuleBar() {
  const loc = useLocation();
  const mods = allModules();
  // Outside any module (Settings), the button still names the module you came from.
  const current = getModule(loc.pathname.split('/')[1]) ?? getModule(lastModuleId());
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Back to the button, but only if focus was inside the list (not when it was somewhere else entirely).
      if (wrap.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <nav className="modulebar" aria-label="Modules and tools">
      <div className="modswitch" ref={wrap}>
        <button ref={button} className="modbtn" aria-expanded={open} aria-controls="module-list" onClick={() => setOpen((o) => !o)}>
          <span className="modicon" aria-hidden="true">{current?.icon}</span>
          <span><span className="sr-only">Switch module. Current module: </span>{current?.name ?? 'Modules'}</span>
          <span className="chev" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="modmenu" id="module-list">
            {mods.map((m) => (
              <Link key={m.id} to={`/${m.id}`} aria-current={m.id === current?.id ? 'page' : undefined} className={m.id === current?.id ? 'active' : ''}>
                <span className="modicon" aria-hidden="true">{m.icon}</span>{m.name}
              </Link>
            ))}
          </div>
        )}
      </div>
      <span className="modspacer" />
      <button className="modsearch" onClick={openSearch} aria-label="Search" title="Search (Ctrl K)"><span aria-hidden="true">⌕</span><span className="modsearch-label">Search</span></button>
      <QuickAdd />
      <SyncChip />
      <Link to="/settings" className={`modsettings ${loc.pathname.startsWith('/settings') ? 'active' : ''}`} aria-current={loc.pathname.startsWith('/settings') ? 'page' : undefined}>Settings</Link>
    </nav>
  );
}
