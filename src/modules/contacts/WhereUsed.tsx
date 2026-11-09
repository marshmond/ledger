import { useState } from 'react';
import { groupReferences, type ContactReference, type Unlisted } from '../../core/contactReferences';
import { usageKindText, usageModuleName, type UsageEntry } from '../../core/contactUsage';
import { dayLabel } from '../../core/time';
import { MAX_LISTED, PREVIEW } from './references';

/** The module the app can open for a reference. Hash routes: `#/tasks?task=12`. */
const hrefOf = (r: ContactReference) => (r.href ? `#${r.href}` : undefined);

function Item({ r }: { r: ContactReference }) {
  const meta = [r.date ? dayLabel(r.date, { year: true }) : '', r.status ?? ''].filter(Boolean).join(' · ');
  const h = hrefOf(r);
  return (
    <li className={`ct-ref${r.inactive ? ' ct-quiet' : ''}`}>
      {h ? <a className="ct-ref-title" href={h}>{r.title}</a> : <span className="ct-ref-title">{r.title}</span>}
      <span className="small">{r.relation}</span>
      {meta && <span className="muted small">{meta}</span>}
    </li>
  );
}

function Group({ id, label, items }: { id: string; label: string; items: ContactReference[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items.slice(0, MAX_LISTED) : items.slice(0, PREVIEW);
  const hidden = items.length - shown.length;
  const h = `ct-ref-${id}`;
  return (
    <section className="ct-refgroup" aria-labelledby={h}>
      <h3 id={h} className="ct-refhead">{label} <span className="muted small">{items.length}</span></h3>
      <ul className="plain ct-reflist">{shown.map((r) => <Item key={`${r.module}|${r.kind}|${r.recordId}|${r.role}`} r={r} />)}</ul>
      {items.length > PREVIEW && (
        <p className="small">
          {all
            ? <button type="button" className="link" onClick={() => setAll(false)}>Show fewer</button>
            : <button type="button" className="link" aria-label={`Show all ${items.length} in ${label}`} onClick={() => setAll(true)}>Show all {items.length}</button>}
          {all && hidden > 0 && <span className="muted"> · Showing the first {MAX_LISTED} of {items.length}.</span>}
        </p>
      )}
    </section>
  );
}

/** One kind of record the numeric scan found that the readers could not name, in words ("2 attachments"). */
const unlistedText = (u: Unlisted) => u.kinds.map((k) => usageKindText({ module: k.module, kind: k.kind, count: k.count } as UsageEntry)).join(', ');

/**
 * "Where this contact is used": the real, named records grouped by module, each opening its own screen. When the complete scan found more records than
 * could be named, or a module could not be checked, the limit is said plainly. Neither case means the contact is unused.
 */
export default function WhereUsed({ refs, unlisted, unverified, loading }: {
  refs: ContactReference[];
  unlisted: Unlisted;
  unverified: { label: string; message: string }[];
  loading?: boolean;
}) {
  const groups = groupReferences(refs);
  return (
    <section className="card" aria-labelledby="ct-used">
      <div className="card-head"><h2 className="card-title" id="ct-used">Where this contact is used</h2></div>
      {loading && <p className="muted" role="status">Checking every module…</p>}
      {!loading && groups.length === 0 && unlisted.total === 0 && unverified.length === 0 && (
        <p className="muted">No record in Ledger names this contact yet. It is not used by Family, Calendar, Tasks, Projects, Home &amp; Assets, Household Services or Bills &amp; Subscriptions.</p>
      )}
      {groups.map((g) => <Group key={g.id} id={g.id} label={g.label} items={g.items} />)}
      {!loading && unverified.length > 0 && (
        <p className="ct-note small" role="status">
          Ledger could not check {unverified.map((u) => u.label).join(', ')}. This list may be missing records from {unverified.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {!loading && unlisted.total > 0 && (
        <p className="ct-note small" role="status">
          Ledger found {unlisted.total === 1 ? 'one more stored record' : `${unlisted.total} more stored records`} that mention{unlisted.total === 1 ? 's' : ''} this contact than it can name here ({unlistedText(unlisted)}). Other stored references may exist, so this list may not be complete.
        </p>
      )}
    </section>
  );
}

/** The conservative counts from the complete scan, kept beneath the named lists as a cross-check. */
export function MentionCounts({ entries, approximate }: { entries: UsageEntry[]; approximate: boolean }) {
  const modules = [...new Set(entries.map((e) => e.module))];
  return (
    <section className="card" aria-labelledby="ct-counts">
      <div className="card-head"><h2 className="card-title" id="ct-counts">Stored mentions (a cross-check)</h2></div>
      {entries.length === 0 ? <p className="muted">No stored record mentions this contact.</p> : (
        <ul className="plain ct-usage">
          {modules.map((m) => <li key={m}><strong>{usageModuleName(m)}</strong>: {entries.filter((e) => e.module === m).map(usageKindText).join(', ')}</li>)}
        </ul>
      )}
      <p className="muted small">These counts come from a complete scan of stored records for this contact’s identifier. They can include a number that only looks like one, and they are a guide, not a list of relationships. {approximate ? 'This contact has an older style of identifier, so the counts may include unrelated records. ' : ''}A difference between these counts and the lists above never means a contact is unused.</p>
    </section>
  );
}
