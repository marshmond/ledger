/**
 * How other modules (Tasks, Calendar, Today) refer to a project without importing the Projects module. A task or event stores only the
 * project's id (`projectId`); this file reads the project's name and state when something needs to show it. It only reads. Projects
 * owns the project records (src/modules/projects).
 *
 * A project reference can be stale: the project may be archived (still real), cancelled, or gone (deleted on another device). Every
 * reader here copes with all three and never throws.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FinanceDB } from '../db';
import { isLive } from './store';

export const PROJECTS_MODULE = 'projects';

export interface ProjectChoice {
  id: number;
  name: string;
  status: string;
  archived: boolean;
}

/** Statuses that count as work in progress for Today and for new links. Completed and cancelled projects are finished. */
export const ACTIVE_PROJECT_STATUSES = ['planning', 'active'];

/** Every live project, by name. Read straight from the shared records so Tasks and Calendar need no Projects code. */
export async function loadProjectChoices(d: FinanceDB = db): Promise<ProjectChoice[]> {
  const rows = (await d.moduleRecords.where('[module+kind]').equals([PROJECTS_MODULE, 'project']).toArray()).filter(isLive);
  return rows
    .map((r) => {
      const x = (r.data ?? {}) as Record<string, unknown>;
      return {
        id: r.id as number,
        name: typeof x.name === 'string' && x.name.trim() ? x.name.trim() : 'Untitled project',
        status: typeof x.status === 'string' ? x.status : 'planning',
        archived: x.archived === true,
      };
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name) || a.id - b.id);
}

export const useProjectChoices = (): ProjectChoice[] => useLiveQuery(() => loadProjectChoices(), []) ?? [];

/**
 * Same list plus whether it has finished loading. An editor uses this so it never flashes "(project removed)" for a moment while the
 * list is still being read.
 */
export function useProjectChoicesLoaded(): { projects: ProjectChoice[]; loaded: boolean } {
  const rows = useLiveQuery(() => loadProjectChoices(), []);
  return { projects: rows ?? [], loaded: rows !== undefined };
}

/** Looks a project up by the id a task or event stored. */
export const findProject = (choices: ProjectChoice[], id: number | undefined | null): ProjectChoice | undefined =>
  id === undefined || id === null ? undefined : choices.find((p) => p.id === id);

/**
 * The words shown for a stored reference: the name, "(archived)" when it is archived, "(cancelled)" when cancelled, or
 * "(project removed)" when the id points at nothing. Returns '' when there is no reference at all.
 */
export function projectLabel(choices: ProjectChoice[], id: number | undefined | null): string {
  if (id === undefined || id === null) return '';
  const p = findProject(choices, id);
  if (!p) return '(project removed)';
  return p.archived ? `${p.name} (archived)` : p.status === 'cancelled' ? `${p.name} (cancelled)` : p.name;
}

/** Where the project page is. */
export const projectPath = (id: number) => `/projects/${id}`;

/** Projects that may be chosen for a NEW link: not archived, not cancelled or completed (plus the one already chosen, so editing never loses it). */
export function selectableProjects(choices: ProjectChoice[], current?: number | null): ProjectChoice[] {
  return choices.filter((p) => p.id === current || (!p.archived && p.status !== 'cancelled' && p.status !== 'completed'));
}

/** Reads the optional `projectId` out of a stored record's data. Anything that is not a whole number is "no project". */
export function readProjectId(data: unknown): number | undefined {
  const v = (data as { projectId?: unknown } | null | undefined)?.projectId;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
