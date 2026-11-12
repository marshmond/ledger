import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SyncChip from './SyncChip';
import QuickAdd from '../shell/QuickAdd';
import { openSearch } from './globalEvents';
import { allModules, getModule, lastModuleId, type ModuleDef } from './registry';
import { groupModules } from './moduleGroups';
import { Icon } from '../ui/icons';

/** The grouped, flat list of module links (no nesting). Exported so the open list can be tested without a browser. */
export function ModuleList({ mods, currentId }: { mods: readonly ModuleDef[]; currentId?: string }) {
  return (
    <>
      {groupModules(mods).map((g) => {
        const links = g.modules.map((m) => (
          <Link key={m.id} to={`/${m.id}`} aria-current={m.id === currentId ? 'page' : undefined} className={m.id === currentId ? 'active' : ''}>
            <span className="modicon" aria-hidden="true">{m.icon}</span>{m.name}
          </Link>
        ));
        // Today stands alone at the top with no heading; every other group is a labelled set of ordinary links (not a menu).
        if (!g.label) return <div key={g.key} className="modgroup modgroup-top">{links}</div>;
        return (
          <div key={g.key} className="modgroup" role="group" aria-labelledby={`modgroup-${g.key}`}>
            <div className="modgroup-label" id={`modgroup-${g.key}`}>{g.label}</div>
            {links}
          </div>
        );
      })}
    </>
  );
}

/** The foot of the open module list: Settings and the sync status. Drawn only on a phone (the stylesheet hides it above 640px, where the bar itself carries both). Exported so it can be tested without a browser. */
export function ModuleFoot({ inSettings }: { inSettings: boolean }) {
  return (
    <div className="modfoot">
      <Link to="/settings" className={inSettings ? 'active' : ''} aria-current={inSettings ? 'page' : undefined}><Icon name="sliders" size={18} />Settings</Link>
      <SyncChip inline />
    </div>
  );
}

/**
 * The application header, across the top of every screen: which module you are in (with a switcher), and the shared Settings.
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
  // The shortcut hint names the key this computer uses (the shortcut itself accepts both).
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

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

  const inSettings = loc.pathname.startsWith('/settings');
  const key = mac ? '⌘K' : 'Ctrl K';

  return (
    <nav className="modulebar" aria-label="Modules and tools">
      {/* The Ledger mark: decoration only (the page title already ends in "Ledger"), drawn only where the palette asks for it (--ui-brand). */}
      <span className="modbrand" aria-hidden="true"><span className="modbrand-mark">L</span><span className="modbrand-name">Ledger</span></span>
      <div className="modswitch" ref={wrap}>
        <button ref={button} className="modbtn" aria-expanded={open} aria-controls="module-list" onClick={() => setOpen((o) => !o)}>
          <span className="modicon" aria-hidden="true">{current?.icon}</span>
          <span className="modname"><span className="sr-only">Switch module. Current module: </span>{current?.name ?? 'Modules'}</span>
          <span className="modall" aria-hidden="true">All modules</span>
          <Icon name="chevron-down" size={16} className="chev" />
        </button>
        {open && (
          <div className="modmenu" id="module-list">
            <ModuleList mods={mods} currentId={current?.id} />
            {/* Phone only (hidden by the stylesheet above 640px, where the bar itself shows these): Settings and the sync status. */}
            <ModuleFoot inSettings={inSettings} />
          </div>
        )}
      </div>
      <span className="modspacer" />
      <button className="modsearch" onClick={openSearch} aria-label="Search" aria-keyshortcuts="Control+K Meta+K" title={`Search (${key})`}>
        <Icon name="search" size={18} />
        <span className="modsearch-label">Search</span>
        <kbd className="modkbd" aria-hidden="true">{key}</kbd>
      </button>
      <SyncChip />
      <Link to="/settings" className={`modsettings ${inSettings ? 'active' : ''}`} aria-current={inSettings ? 'page' : undefined}><Icon name="sliders" size={18} className="modsettings-icon" />Settings</Link>
      <QuickAdd />
    </nav>
  );
}
