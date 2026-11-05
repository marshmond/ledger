/**
 * The module registry. Adding a module (Calendar, Tasks, ...) means writing one `ModuleDef` and listing it in
 * `src/modules/index.ts`; the top bar, the routes and "open to the last module used" all come from this list.
 */
import type { ComponentType, ReactNode } from 'react';
import type { RecordId } from './entities';
import { registerDueProvider, type DueProvider } from './dueProvider';

export interface ModuleNavItem {
  to: string;
  label: string;
  keywords?: string;
}
export interface ModuleNavGroup {
  id: string;
  label: string;
  to: string;
  items: ModuleNavItem[];
}

export interface ModuleDef {
  /** Short, lowercase, permanent. Used in addresses (`#/ledger/...`) and as the data namespace. */
  id: string;
  name: string;
  icon: ReactNode;
  /** The module's whole experience (its own sidebar, pages and routes). Rendered at `/<id>/*`. */
  Component: ComponentType;
  /** Page addresses inside the module, written without the prefix (`/budget`). Old bookmarks use the same list. */
  routePaths: string[];
  /** The module's own navigation map (informational for the shell; the module draws its own sidebar). */
  nav: ModuleNavGroup[];
  /**
   * True when the module draws its own bottom tab bar on phones (only Ledger does). The shell uses it to keep the round "+" button
   * and the toasts clear of that bar; modules without one get the screen's bottom edge.
   */
  hasTabBar?: boolean;
  /** Optional hooks other modules (the Calendar, Tasks) read. */
  contributes?: {
    /** Dated things this module works out on the fly for the Calendar. Read-only; see docs/due-provider.md. */
    dueProvider?: DueProvider;
    /** Lets other modules link to this module's records (a task about an account) and show them by name. */
    records?: RecordSource;
    /**
     * "Create this in my module instead": lets a Calendar event of a given type hand itself over (a Bill event becomes a Ledger
     * scheduled item). The module draws its own prefilled form; the Calendar retires the event only after the module reports success.
     */
    createFromEvent?: EventHandoff;
    /** Cards this module offers the Today screen. See docs/module-hooks.md. */
    todayCards?: TodayCardDef[];
    /** What global search can find in this module. See docs/module-hooks.md. */
    searchSource?: SearchSource;
    /** What the global quick-add box can create in this module. See docs/module-hooks.md. */
    quickAdd?: QuickAddDef;
  };
}

/** What a Today card receives. Dates are 'YYYY-MM-DD' in local time; `today` changes at midnight. */
export interface TodayCardProps {
  today: string;
  /** The "Hide amounts" switch in Today's header. A card that shows money must honour it. */
  hideAmounts: boolean;
  /** A card calls this with true when it has nothing to show, so a card marked `hideWhenEmpty` can disappear. */
  reportEmpty(empty: boolean): void;
}
export interface TodayCardDef {
  /** Permanent. Saved layouts refer to it (`ledger.alerts`). Use `<module>.<name>`. */
  id: string;
  title: string;
  defaultWidth: 'half' | 'full';
  /** Position in the default layout; lower comes first. */
  priority: number;
  /** Disappear (instead of showing an empty state) when the card reports it has nothing. */
  hideWhenEmpty?: boolean;
  Component: ComponentType<TodayCardProps>;
}

/** One thing global search found. `path` is a full address (`/ledger/accounts`); `open` is for hits that need more than navigation. */
export interface SearchResult {
  /** Stable within the module, used as the list key. */
  id: string;
  title: string;
  subtitle?: string;
  /** Short kind label shown as a badge, e.g. "Task". */
  kind: string;
  /** Higher ranks first. Within a module only; results are grouped by module. */
  score?: number;
  path?: string;
  open?(): void | Promise<void>;
}
export interface SearchSource {
  /** Heading for the group of results, e.g. "Tasks". Defaults to the module name. */
  group?: string;
  /** Results for the typed text (not trimmed or lower-cased for you). Must be fast; a linear scan is fine. */
  search(query: string, limit: number): Promise<SearchResult[]> | SearchResult[];
  /**
   * Optional. Called when the search dialog opens; returns a function called when it closes. A source whose data is slow to read can keep
   * a live in-memory snapshot between the two (Ledger does this for its transactions). Not an index: nothing is stored.
   */
  start?(): () => void;
}

/** What the quick-add box shows before saving: a one-line summary and the fields the text was understood as. */
export interface QuickAddPreview {
  /** "Will add: Pay rent, Friday, high priority". */
  summary: string;
  fields: { label: string; value: string }[];
  /** Whatever `commit` needs; opaque to the shell. */
  payload: unknown;
}
export interface QuickAddDef {
  /** Permanent short id, e.g. `task`. */
  id: string;
  /** Chooser text, e.g. "Task". */
  label: string;
  /** Typed shortcut: text starting with `<prefix> ` picks this destination. One short token (`t`, `e`, `$`). */
  prefix: string;
  /** Understands the text (prefix already removed), or returns null when it is not something this destination can make. */
  parse(text: string): QuickAddPreview | null;
  /** Creates the record. Only called after the user has seen the preview and pressed Add. */
  commit(preview: QuickAddPreview): Promise<void>;
}

/** What the Calendar knows about an event, in plain terms, when it offers a handoff. Nothing here is Ledger-specific. */
export interface EventSeed {
  title: string;
  /** The date to start from. For a repeating event: its next occurrence on or after today (so old dates do not flood the other module). */
  date: string;
  notes: string;
  /** null = a one-time event. */
  repeat: null | {
    unit: 'day' | 'week' | 'month' | 'year';
    every: number;
    /** True when the repeat is something simple units cannot say (several weekdays, "2nd Tuesday"). The module should ask. */
    complex: boolean;
    /** Plain-language description, e.g. "Every 2 weeks on Mon". */
    plain: string;
    /** Last date, if the repeat ends. */
    endDate?: string;
  };
  /** True when single dates of the series were skipped or changed on their own (those do not carry over). */
  hasExceptions: boolean;
}
export interface HandoffResult {
  /** The new record's id in the other module, e.g. `scheduled:7`. */
  recordId: RecordId;
  label: string;
}
export interface HandoffFormProps {
  seed: EventSeed;
  /** Said to the user on the module's confirmation step (e.g. "the calendar event will be removed so it is not listed twice"). */
  consequence: string;
  /** The module has created its record. The Calendar then retires the event. */
  onCreated(result: HandoffResult): void;
  /** The user backed out; nothing was created. The event stays as it is. */
  onCancel(): void;
}
export interface EventHandoff {
  /** Event types that offer this handoff (`bill`). */
  types: string[];
  /** Button text, e.g. "Create scheduled item in Ledger". */
  label: string;
  /** Name of the module that takes over, for sentences like "Ledger will own this item". */
  ownerName: string;
  /** The module's own form, shown in a dialog. */
  Form: ComponentType<HandoffFormProps>;
}

/** A record another module can link to. Ids are text like `account:12`, because one module can have several kinds of record. */
export interface RecordChoice {
  id: RecordId;
  label: string;
  /** Short kind label, e.g. "Account". */
  kind: string;
}
export interface RecordSource {
  /** Records whose name contains `text` (empty text = a short default list). */
  search(text: string): Promise<RecordChoice[]>;
  /** The record's current name and the full address that opens it, or null if it no longer exists. */
  describe(id: RecordId): Promise<{ label: string; kind: string; path: string } | null>;
  /** Opens the record in its own module (navigation only). Returns false when it no longer exists. */
  openSource?(id: RecordId): Promise<boolean>;
}

const modules: ModuleDef[] = [];

export function registerModule(m: ModuleDef) {
  if (modules.some((x) => x.id === m.id)) throw new Error(`Module "${m.id}" is registered twice.`);
  checkHooks(m);
  modules.push(m);
  if (m.contributes?.dueProvider) registerDueProvider(m.contributes.dueProvider);
}
/** Catches hook mistakes at start-up instead of as a confusing screen: a badly named or repeated card id, or a quick-add prefix already taken. */
function checkHooks(m: ModuleDef) {
  for (const c of m.contributes?.todayCards ?? []) {
    if (!c.id.startsWith(`${m.id}.`)) throw new Error(`Today card "${c.id}" must start with "${m.id}.".`);
    if (allTodayCards().some((x) => x.id === c.id)) throw new Error(`Today card "${c.id}" is registered twice.`);
  }
  const q = m.contributes?.quickAdd;
  if (q) {
    const clash = allQuickAdds().find((x) => x.prefix.toLowerCase() === q.prefix.toLowerCase() || x.id === q.id);
    if (clash) throw new Error(`Quick-add "${q.id}" (prefix "${q.prefix}") clashes with "${clash.id}" (prefix "${clash.prefix}").`);
  }
}
export const allModules = (): readonly ModuleDef[] => modules;
/** Every Today card offered by any module, in default-layout order. */
export function allTodayCards(mods: readonly ModuleDef[] = modules): (TodayCardDef & { moduleId: string })[] {
  return mods.flatMap((m) => (m.contributes?.todayCards ?? []).map((c) => ({ ...c, moduleId: m.id }))).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
/** Every module that can be searched, with its search hook. */
export function allSearchSources(mods: readonly ModuleDef[] = modules): { moduleId: string; moduleName: string; source: SearchSource }[] {
  return mods.flatMap((m) => (m.contributes?.searchSource ? [{ moduleId: m.id, moduleName: m.name, source: m.contributes.searchSource }] : []));
}
/** Every quick-add destination, in module order. */
export function allQuickAdds(mods: readonly ModuleDef[] = modules): (QuickAddDef & { moduleId: string })[] {
  return mods.flatMap((m) => (m.contributes?.quickAdd ? [{ ...m.contributes.quickAdd, moduleId: m.id }] : []));
}
export const recordSource = (moduleId: string) => modules.find((m) => m.id === moduleId)?.contributes?.records;
/** The module that offers to take over events of this type, if any. */
export function handoffFor(type: string | undefined): (EventHandoff & { moduleId: string }) | undefined {
  const m = type ? modules.find((x) => x.contributes?.createFromEvent?.types.includes(type)) : undefined;
  return m?.contributes?.createFromEvent ? { ...m.contributes.createFromEvent, moduleId: m.id } : undefined;
}
export const getModule =(id: string | null | undefined) => modules.find((m) => m.id === id);

const LAST_KEY = 'ledger-last-module';
/** The module to open when no module is named in the address: the one used last, else the first registered. */
export function lastModuleId(store: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  let id: string | null = null;
  try { id = store?.getItem(LAST_KEY) ?? null; } catch { /* storage unavailable */ }
  return getModule(id)?.id ?? modules[0]?.id ?? 'ledger';
}
export function rememberModule(id: string, store: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { store?.setItem(LAST_KEY, id); } catch { /* storage unavailable */ }
}
function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
