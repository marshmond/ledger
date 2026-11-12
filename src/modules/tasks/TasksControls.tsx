import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Priority } from '../../core/entities';
import { PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL } from '../../core/priority';
import { projectLabel, type ProjectChoice } from '../../core/projectLink';
import { rovingKeys } from '../../ui/rovingKeys';
import { Icon } from '../../ui/icons';
import type { TaskList } from './model';
import { SORTS, VIEWS, type Filter, type SortKey, type ViewId } from './views';
import { isMoreView, phoneMoreViews, phonePrimaryViews } from './viewModel';

/**
 * D11: the Tasks screen's view buttons and filter controls. There is ONE filter state (the page's `filter`) and every control here only reads
 * it and reports a change through `onChange`; the computer's chips and the phone's Filters sheet draw the same `FilterFields`, so they offer the
 * same options in the same order and reset to the same `NO_FILTER`. Only one of the two is on screen at a time (the page picks by width).
 */
export interface FilterEnv {
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  lists: TaskList[];
  tags: { id: number; name: string }[];
  projects: ProjectChoice[];
}

type Counts = { today: number; overdue: number; waiting: number };
const countOf = (id: ViewId, c: Counts) => (id === 'today' ? c.today : id === 'overdue' ? c.overdue : id === 'waiting' ? c.waiting : 0);

/** The computer's ten views: one tab list (arrow keys move between tabs, as before). */
export function ViewTabs({ view, counts, onGo }: { view: ViewId; counts: Counts; onGo: (v: ViewId) => void }) {
  return (
    <div className="ui-tabs tk-tabs" role="tablist" aria-label="Task views" onKeyDown={rovingKeys}>
      {VIEWS.map((v) => {
        const n = countOf(v.id, counts);
        return (
          <button key={v.id} role="tab" aria-selected={view === v.id} tabIndex={view === v.id ? 0 : -1} className={view === v.id ? 'on' : ''} onClick={() => onGo(v.id)}>
            {v.label}{n > 0 && <span className={`count${v.id === 'overdue' ? ' tk-count--late' : ''}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The phone's four main views plus "More" for the other six. Choosing one of those makes it the active view and the More button then names it. */
export function PhoneViews({ view, counts, onGo }: { view: ViewId; counts: Counts; onGo: (v: ViewId) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const moreActive = isMoreView(view);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); moreBtn.current?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const pick = (v: ViewId) => { setOpen(false); onGo(v); moreBtn.current?.focus({ preventScroll: true }); };
  return (
    <div className="tk-pviews" ref={wrap}>
      <div className="ui-seg tk-pseg" role="group" aria-label="Task views">
        {phonePrimaryViews().map((v) => {
          const n = countOf(v.id, counts);
          return <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => onGo(v.id)}>{v.label}{n > 0 && <span className={`count${v.id === 'overdue' ? ' tk-count--late' : ''}`}>{n}</span>}</button>;
        })}
        <button ref={moreBtn} type="button" className={moreActive ? 'on' : ''} aria-pressed={moreActive} aria-expanded={open} aria-haspopup="true" aria-controls="tk-more" aria-label={moreActive ? undefined : 'More task views'} onClick={() => setOpen(!open)}>
          {moreActive ? VIEWS.find((v) => v.id === view)?.label : <span className="tk-morelabel">More</span>} <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {open && (
        <div className="tk-more" id="tk-more" role="group" aria-label="More task views">
          {phoneMoreViews().map((v) => {
            const n = countOf(v.id, counts);
            return <button key={v.id} type="button" aria-pressed={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => pick(v.id)}>{v.label}{n > 0 && <span className="count">{n}</span>}</button>;
          })}
        </div>
      )}
    </div>
  );
}

/** The four filter selects (priority, list, tag, project). Used by BOTH the computer chips and the phone sheet. */
export function FilterFields({ env, labelled = false }: { env: FilterEnv; labelled?: boolean }) {
  const { filter, onChange, lists, tags, projects } = env;
  const chip = (on: boolean) => `tk-chip${on ? ' on' : ''}`;
  const wrap = (label: string, control: ReactNode) => (labelled ? <label className="ui-field"><span className="ui-label">{label}</span>{control}</label> : control);
  return (
    <>
      {wrap('Priority', (
        <select className={chip(filter.priority !== '')} value={filter.priority} onChange={(e) => onChange({ priority: e.target.value as Priority | '' })} aria-label="Filter by priority">
          <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}</option>)}
        </select>
      ))}
      {wrap('List', (
        <select className={chip(filter.listId !== '')} value={String(filter.listId)} onChange={(e) => onChange({ listId: e.target.value === '' ? '' : e.target.value === 'none' ? 'none' : Number(e.target.value) })} aria-label="Filter by list">
          <option value="">Any list</option><option value="none">No list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      ))}
      {wrap('Tag', (
        <select className={chip(filter.tagId !== '')} value={String(filter.tagId)} onChange={(e) => onChange({ tagId: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Filter by tag">
          <option value="">Any tag</option>{tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
        </select>
      ))}
      {projects.length > 0 && wrap('Project', (
        <select className={chip((filter.projectId ?? '') !== '')} value={String(filter.projectId ?? '')} onChange={(e) => onChange({ projectId: e.target.value === '' ? '' : e.target.value === 'none' ? 'none' : Number(e.target.value) })} aria-label="Filter by project">
          <option value="">Any project</option><option value="none">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(projects, p.id)}</option>)}
        </select>
      ))}
    </>
  );
}

/** Sort choice. In Completed the page maps "due" to "recently completed" before calling this, as before. */
export function SortSelect({ value, view, onChange, labelled = false }: { value: SortKey; view: ViewId; onChange: (s: SortKey) => void; labelled?: boolean }) {
  const select = (
    <select className="tk-chip" value={value} onChange={(e) => onChange(e.target.value as SortKey)} aria-label="Sort by">
      {SORTS.filter((s) => s.id !== 'completed' || view === 'completed').map((s) => <option key={s.id} value={s.id}>{labelled ? s.label : `Sort: ${s.label}`}</option>)}
    </select>
  );
  return labelled ? <label className="ui-field"><span className="ui-label">Sort by</span>{select}</label> : select;
}

export function RangeSelect({ value, onChange, labelled = false }: { value: number; onChange: (n: number) => void; labelled?: boolean }) {
  const select = (
    <select className="tk-chip" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Upcoming range">
      {[7, 14, 30].map((d) => <option key={d} value={d}>Next {d} days</option>)}
    </select>
  );
  return labelled ? <label className="ui-field"><span className="ui-label">Upcoming range</span>{select}</label> : select;
}
