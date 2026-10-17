import { useState, type ReactNode } from 'react';

const KEY = 'ledger-tabs';

function read(id: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}
function write(id: string, tab: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
    all[id] = tab;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the choice just is not remembered */ }
}

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/** Tabs inside a long page, so it is a few short views instead of one long scroll. Remembers the last tab per page on this device. */
export default function PageTabs({ id, tabs }: { id: string; tabs: TabDef[] }) {
  const [cur, setCur] = useState<string>(() => {
    const saved = read(id);
    return tabs.some((t) => t.id === saved) ? (saved as string) : tabs[0].id;
  });
  const active = tabs.find((t) => t.id === cur) ?? tabs[0];
  return (
    <>
      <div className="pagetabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === active.id} className={t.id === active.id ? 'on' : ''} onClick={() => { setCur(t.id); write(id, t.id); }}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel">{active.content}</div>
    </>
  );
}
