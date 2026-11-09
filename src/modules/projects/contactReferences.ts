/**
 * Contacts C2: which Projects name a Contact. READ ONLY. Two stored fields, nothing inferred from Task titles or project names:
 *  - `project.vendorContactIds` ("Vendors and people" on the project);
 *  - `commitment.vendorContactId` (the vendor on a quote or agreement). A commitment is listed with a link to its project's page. Amounts are never shown.
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asCommitment, COMMITMENT_LABEL } from './commitmentModel';
import { asProject, MODULE, STATUS_LABEL } from './model';

export const projectsContactReferences: ContactReferenceProvider = {
  label: 'Projects',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    const projects = (await readRows(d, MODULE, 'project', asProject)).sort((a, b) => a.id - b.id);
    const byId = new Map(projects.map((p) => [p.id, p]));
    for (const p of projects) {
      for (const cid of new Set(p.data.vendorContactIds)) {
        if (!ids.has(cid)) continue;
        const ended = p.data.archived || p.data.status === 'completed' || p.data.status === 'cancelled';
        out.push({
          contactId: cid, module: 'projects', kind: 'project', recordId: String(p.id), role: 'vendor', facet: 'project',
          title: p.data.name.trim() || 'Untitled project',
          relation: 'Listed under Vendors and people on this project',
          href: `/projects/${p.id}`,
          ...(p.data.targetDate ? { date: p.data.targetDate } : {}),
          status: `${STATUS_LABEL[p.data.status]}${p.data.archived ? ', archived' : ''}`,
          ...(ended ? { inactive: true } : {}),
        });
      }
    }
    for (const c of await readRows(d, MODULE, 'commitment', asCommitment)) {
      const cid = c.data.vendorContactId;
      if (cid === null || !ids.has(cid)) continue;
      const p = byId.get(c.data.projectId);
      const over = c.data.status === 'declined' || c.data.status === 'cancelled';
      out.push({
        contactId: cid, module: 'projects', kind: 'commitment', recordId: String(c.id), role: 'vendor', facet: 'project',
        title: c.data.title.trim() || 'Untitled commitment',
        relation: `Vendor on this commitment (${COMMITMENT_LABEL[c.data.status].toLowerCase()})${p ? ` in the project “${p.data.name.trim() || 'Untitled project'}”` : ' (its project no longer exists)'}`,
        ...(p ? { href: `/projects/${p.id}` } : {}),
        ...(c.data.acceptedDate ? { date: c.data.acceptedDate } : {}),
        status: COMMITMENT_LABEL[c.data.status],
        ...(over ? { inactive: true } : {}),
      });
    }
    return out;
  },
};
