/**
 * D9: how a Family member's STORED color becomes something to draw. PURE (no database, clock or network).
 *
 * The stored value is still one of the eight hex values in `COLORS` (model.ts) or absent. Nothing here stores, migrates or invents a color. This file
 * only gives each stored value its semantic id (the lower-case color name, which is also the name of the `--mc-<id>` presentation token), so the shared
 * identity pieces in `src/ui` can draw it without a hex. A value that is not one of the eight, or no value, gives `null` = "No color".
 */
import type { MemberColorId } from '../../ui/memberIdentityModel';
import { COLORS, ROLE_LABEL, type MemberRecord, type Role } from './model';

export interface MemberColorChoice {
  id: MemberColorId;
  /** The stored hex: the authority, exactly as in `COLORS`. */
  value: string;
  /** Shown beside the swatch, and the swatch's accessible name. */
  name: string;
}

/** The eight choices, in `COLORS` order. The id is the color's name in lower case (a test pins that every one is a known id with a token). */
export const MEMBER_COLOR_CHOICES: readonly MemberColorChoice[] = COLORS.map((c) => ({ id: c.name.toLowerCase() as MemberColorId, value: c.value, name: c.name }));

/** The semantic id for a stored value, or null for "no color" (absent, empty or not one of the eight). */
export function memberColorId(value: string | undefined | null): MemberColorId | null {
  return MEMBER_COLOR_CHOICES.find((c) => c.value === value)?.id ?? null;
}

/** The readable name for a stored value ("Blue"), or "" for no color. */
export function memberColorLabel(value: string | undefined | null): string {
  return MEMBER_COLOR_CHOICES.find((c) => c.value === value)?.name ?? '';
}

/** The words for the "No color" choice, and the short form used in a chip. */
export const NO_COLOR_CHOICE = 'No color — neutral gray';
export const NO_COLOR_CHIP = 'No color · neutral gray';
export const COLOR_IN_USE = 'This color is already used by another family member.';

/**
 * Is this stored color already chosen by ANOTHER active member? Uses only the members the form has already loaded. Sharing a color is allowed, so this is
 * a gentle sentence and never blocks saving. The member being edited does not count against themself; past members and unreadable rows do not count.
 */
export function colorUsedByAnother(members: readonly MemberRecord[], selfId: number | undefined, value: string): boolean {
  if (!value) return false;
  return members.some((m) => m.id !== selfId && m.data?.status === 'active' && m.data.color === value);
}

/**
 * The name the preview shows, from the form's CURRENT state and nothing else. Editing: the linked Contact's name (fixed). Adding from an existing
 * Contact: the Contact the person picked. Adding a new Contact: the name typed so far. It is exactly the name that would be used, never a guess or a
 * near match; an empty string means "no name yet".
 */
export function previewName(s: { editing: boolean; mode: 'existing' | 'new'; linkedName?: string; pickedName?: string; newName: string }): string {
  if (s.editing) return (s.linkedName ?? '').trim();
  if (s.mode === 'existing') return (s.pickedName ?? '').trim();
  return s.newName.replace(/\s+/g, ' ').trim();
}

/** Everything the preview card prints, as data. */
export interface MemberPreview {
  /** '' when no name yet (the card then says "New member"). */
  name: string;
  roleLabel: string;
  colorId: MemberColorId | null;
  /** "Teal" or "No color · neutral gray". */
  colorText: string;
}
export function memberPreview(name: string, role: Role, color: string): MemberPreview {
  const colorId = memberColorId(color);
  return { name, roleLabel: ROLE_LABEL[role], colorId, colorText: colorId ? memberColorLabel(color) : NO_COLOR_CHIP };
}
