import { useCallback, useId, useState, type ReactNode } from 'react';

/**
 * A section with a clickable heading that collapses its content. Open by default; whatever you collapse is remembered per
 * device (localStorage). Content stays mounted while collapsed (just hidden), so anything being edited is not lost.
 */

export const COLLAPSE_KEY = 'ledger-collapsed';

export function parseCollapsed(raw: string | null): Record<string, boolean> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readCollapsed(id: string, storage?: StorageLike): boolean | undefined {
  try {
    return parseCollapsed((storage ?? localStorage).getItem(COLLAPSE_KEY))[id];
  } catch {
    return undefined;
  }
}

export function writeCollapsed(id: string, collapsed: boolean, storage?: StorageLike): void {
  try {
    const s = storage ?? localStorage;
    const all = parseCollapsed(s.getItem(COLLAPSE_KEY));
    if (collapsed) all[id] = true;
    else delete all[id]; // open is the default, so there is nothing to remember
    s.setItem(COLLAPSE_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the section still collapses for this visit */
  }
}

export function useCollapsed(id: string, defaultOpen = true): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    const saved = readCollapsed(id);
    return saved === undefined ? defaultOpen : !saved;
  });
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      writeCollapsed(id, !v);
    },
    [id],
  );
  return [open, setOpen];
}

export default function Collapsible({
  id,
  title,
  level = 2,
  right,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: ReactNode;
  level?: 2 | 3;
  right?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useCollapsed(id, defaultOpen);
  const bodyId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className="collapsible">
      <div className="collapse-head">
        <Heading>
          <button className="collapse-btn" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span> {title}
          </button>
        </Heading>
        {right}
      </div>
      <div id={bodyId} hidden={!open}>{children}</div>
    </section>
  );
}
