/**
 * Family member identity, as plain data (D9). Pure: no database, clock, storage or network, and no hex colors.
 *
 * A member's color is STORED as one of eight hex values (src/modules/family/model.ts COLORS: that file stays the authority). This file only knows the
 * eight SEMANTIC ids that the presentation tokens are named after (`--mc-blue` and so on in src/ui/tokens.css, each with a lighter dark-theme value).
 * The module that owns the stored value turns it into an id (Family: `memberColorId`); the shared components below draw from the id alone, so a later
 * screen can show "this person's color" without a hard-coded hex. `null` means "no color": the components then draw a neutral gray, never a
 * stored color.
 *
 * Identity only. A member color is never a status, never a calendar color and never the only cue: show the name or initials beside it.
 */

/** The eight ids, in the order the picker shows them. Each has a `--mc-<id>` token (src/ui/tokens.css) and a `[data-mc="<id>"]` rule (components.css). */
export const MEMBER_COLOR_IDS = ['blue', 'green', 'orange', 'purple', 'pink', 'gold', 'teal', 'gray'] as const;
export type MemberColorId = (typeof MEMBER_COLOR_IDS)[number];

export const isMemberColorId = (v: unknown): v is MemberColorId => typeof v === 'string' && (MEMBER_COLOR_IDS as readonly string[]).includes(v);

/** The CSS custom property that holds this color (light or dark value, whichever theme is on). */
export const memberColorToken = (id: MemberColorId): string => `--mc-${id}`;

/**
 * One or two capital initials for a name. Pure and forgiving: extra spaces, a missing name, one word, hyphens, accents and symbols are all fine.
 * One word gives one letter. Two or more words give the first letter of the first and of the last word ("Mary Ann Smith" gives "MS").
 * A word with no letter or digit in it (a lone dash, an emoji) is skipped. Empty or missing gives "".
 */
export function memberInitials(name: string | null | undefined): string {
  const first = (w: string) => Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch));
  const letters = String(name ?? '').split(/\s+/).map(first).filter((c): c is string => !!c);
  if (letters.length === 0) return '';
  const picked = letters.length === 1 ? letters[0] : letters[0] + letters[letters.length - 1];
  return picked.toLocaleUpperCase();
}

export type MemberMarkSize = 'sm' | 'md' | 'lg' | 'xl';
