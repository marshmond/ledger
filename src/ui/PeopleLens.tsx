import type { ReactNode } from 'react';
import { nameList, type HouseholdPerson } from '../core/householdPeople';
import type { Lens } from '../core/peopleLens';
import { MemberChip, MemberDot } from './MemberIdentity';

/**
 * R4.2: the shared pieces that show WHO a Calendar event, Task or family item concerns, and the person filter. Presentational: the caller passes the people
 * (already resolved from the record's own `contactIds`) and the pieces never look anything up or save anything.
 *
 * Color is never the only cue: `names` prints every name; `dots` is for tight places (a Calendar grid cell) and always carries the names as text for a screen
 * reader and as a tooltip. Everyone a record names is shown, none is picked as "the" person; when space runs out the rest become "+N" with the names in the
 * tooltip and the spoken text.
 */
export function PeopleChips({ people, variant = 'names', max = 3 }: { people: readonly HouseholdPerson[]; variant?: 'names' | 'dots'; max?: number }) {
  if (people.length === 0) return null;
  const all = nameList(people.map((p) => p.name));
  if (variant === 'dots') {
    const shown = people.slice(0, max);
    return (
      <span className="ui-people ui-people--dots" title={`For ${all}`}>
        {shown.map((p) => <MemberDot key={p.memberId} colorId={p.colorId} />)}
        {people.length > shown.length && <span className="ui-people-more" aria-hidden="true">+{people.length - shown.length}</span>}
        <span className="sr-only">For {all}</span>
      </span>
    );
  }
  const shown = people.slice(0, max);
  const rest = people.slice(shown.length);
  return (
    <span className="ui-people">
      {shown.map((p) => <MemberChip key={p.memberId} colorId={p.colorId}>{p.name}</MemberChip>)}
      {rest.length > 0 && <span className="ui-people-more" title={`Also: ${nameList(rest.map((p) => p.name))}`}>+{rest.length}<span className="sr-only"> more: {nameList(rest.map((p) => p.name))}</span></span>}
    </span>
  );
}

/**
 * "Everyone" and one button per household person (several can be on at once). Shown only when the household has two or more people, since one person has
 * nothing to choose between. `note` is the plain-words scope of the filter on THIS screen. Choosing a person never changes a record or the Calendar's layers.
 */
export function PeopleFilterBar({ lens, label = 'Family', note, className = '' }: { lens: Lens; label?: string; note?: ReactNode; className?: string }) {
  const people = lens.people ?? [];
  if (people.length < 2) return null;
  return (
    <div className={`ui-lens ${className}`.trim()}>
      <div className="ui-lens-row" role="group" aria-label={`${label}: show everyone or choose people`}>
        <span className="ui-lens-label" aria-hidden="true">{label}</span>
        <button type="button" className="ui-lens-btn" aria-pressed={!lens.active} onClick={lens.clear}>Everyone</button>
        {people.map((p) => (
          <button key={p.memberId} type="button" className="ui-lens-btn" aria-pressed={lens.selected.includes(p.contactId)} onClick={() => lens.toggle(p.contactId)}>
            <MemberDot colorId={p.colorId} />{p.name}
          </button>
        ))}
      </div>
      {lens.active && (
        <p className="ui-lens-note small" role="status">
          <strong>Showing {nameList(lens.chosen.map((p) => p.name))}.</strong> {note} <button type="button" className="link" onClick={lens.clear}>Show everyone</button>
        </p>
      )}
    </div>
  );
}
