import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SyncChip from './SyncChip';
import QuickAdd from '../shell/QuickAdd';
import { openSearch } from './globalEvents';
import { allModules, getModule, lastModuleId } from './registry';

/** The thin bar across the top of every screen: which module you are in (with a switcher), and the shared Settings. */
export default function ModuleBar() {
  const loc = useLocation();
  const mods = allModules();
  // Outside any module (Settings), the button still names the module you came from.
  const current = getModule(loc.pathname.split('/')[1]) ?? getModule(lastModuleId());
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="modulebar">
      <div className="modswitch" ref={wrap}>
        <button className="modbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="modicon">{current?.icon}</span>
          <span>{current?.name ?? 'Modules'}</span>
          <span className="chev" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="modmenu" role="menu" aria-label="Modules">
            {mods.map((m) => (
              <Link key={m.id} to={`/${m.id}`} role="menuitem" className={m.id === current?.id ? 'active' : ''}>
                <span className="modicon">{m.icon}</span>{m.name}
              </Link>
            ))}
          </div>
        )}
      </div>
      <span className="modspacer" />
      <button className="modsearch" onClick={openSearch} aria-label="Search" title="Search (Ctrl K)"><span aria-hidden="true">⌕</span><span className="modsearch-label">Search</span></button>
      <QuickAdd />
      <SyncChip />
      <Link to="/settings" className={`modsettings ${loc.pathname.startsWith('/settings') ? 'active' : ''}`}>Settings</Link>
    </div>
  );
}
