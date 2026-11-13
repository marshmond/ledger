import type { FieldStatus, TaxProvenance, TaxTables } from '../data/taxYears';

/** How many values of each kind a table has, in plain words (also used by tests). */
export function provenanceCounts(p: TaxProvenance): Record<FieldStatus, number> {
  const out: Record<FieldStatus, number> = { verified: 0, statutory: 0, provisional: 0, approximation: 0 };
  for (const f of p.fields) out[f.status] += 1;
  return out;
}

const LABEL: Record<FieldStatus, string> = {
  verified: 'verified from an official publication',
  statutory: 'fixed by law (not adjusted for inflation)',
  provisional: 'provisional (placeholder, no official value yet)',
  approximation: 'Ledger planning estimate',
};

/** Small "where do these numbers come from" panel for built-in tax tables. Shows what is not fully verified first. */
export default function TaxProvenanceNote({ year, provenance }: { year: number; provenance: TaxProvenance }) {
  const c = provenanceCounts(provenance);
  const open = provenance.fields.filter((f) => f.status === 'provisional' || f.status === 'approximation');
  return (
    <details className="an-note" aria-label={`Where the ${year} tax numbers come from`}>
      <summary>
        {year} tables: {c.verified} verified, {c.statutory} fixed by law, {c.provisional} provisional, {c.approximation} planning estimate
        {c.provisional > 0 ? ' (not fully verified)' : ''}
      </summary>
      <p>Read from the official sources on {provenance.checkedOn}. Values still to confirm:</p>
      <ul>
        {open.map((f) => <li key={f.field}><strong>{f.field}</strong> ({LABEL[f.status]}): {f.note}</li>)}
      </ul>
      <p>Sources:</p>
      <ul>
        {provenance.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> <span className="muted">(published {s.published})</span></li>)}
      </ul>
    </details>
  );
}

/** The material fields where a saved custom table differs from the published built-in one (names in plain words). Empty = no warning. */
export function customTableDifferences(custom: TaxTables, builtIn: TaxTables): string[] {
  const out: string[] = [];
  if (custom.stdDeductionMFJ !== builtIn.stdDeductionMFJ) out.push('joint standard deduction');
  if (custom.ssWageBase !== builtIn.ssWageBase) out.push('Social Security wage base');
  if (JSON.stringify(custom.fedBracketsMFJ) !== JSON.stringify(builtIn.fedBracketsMFJ)) out.push('federal brackets');
  if (custom.limits?.k401Deferral !== builtIn.limits.k401Deferral) out.push('401(k) limit');
  return out;
}

/** Informational only: shown when a saved custom table is in use and differs from the published table. Changes nothing. */
export function CustomTableNotice({ year, differences, onEdit }: { year: number; differences: string[]; onEdit: () => void }) {
  if (differences.length === 0) return null;
  return (
    <p className="an-note" role="status">
      Your saved {year} tax tables are being used instead of the published built-in figures. They differ in: {differences.join(', ')}.
      This may be intentional, or a copy made before the {year} numbers were published. <button className="link" onClick={onEdit}>View or edit</button>
      {' '}the tables; <strong>Reset to built-in</strong> is in that editor.
    </p>
  );
}
