import type { QuickAddDef } from '../../core/registry';
import { createProject, removeProjectRecord } from './data';
import { blankProject } from './model';

/**
 * The Add box's Project destination: the text is the project's name, the project starts in Planning. Everything else (dates, budget,
 * lines, vendors) is filled in on the project's own page. Undo removes the project again (it has nothing attached yet).
 */
export const projectQuickAdd: QuickAddDef = {
  id: 'project',
  label: 'Project',
  prefix: 'p',
  aliases: ['project'],
  parse(text) {
    const name = text.trim().replace(/\s+/g, ' ');
    if (!name) return null;
    if (name.length > 120) return null;
    return { summary: `Project "${name}", Planning`, fields: [{ label: 'Project', value: name }, { label: 'Status', value: 'Planning' }], payload: name };
  },
  async commit(preview) {
    const id = await createProject(blankProject({ name: preview.payload as string }));
    return async () => { await removeProjectRecord(id); };
  },
};
