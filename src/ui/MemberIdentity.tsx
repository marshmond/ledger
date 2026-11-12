import type { ReactNode } from 'react';
import { memberInitials, type MemberColorId, type MemberMarkSize } from './memberIdentityModel';

/**
 * Family member identity pieces (D9). Presentational and independent of any module: the caller passes the person's name and a semantic color id
 * (or nothing, for "no color"), and the pieces never look anything up, save anything or decide who someone is.
 *
 *  - MemberMark: a tinted tile with the person's initials (a "?" when there is no name yet).
 *  - MemberDot:  a small round color marker, to sit next to a name.
 *  - MemberChip: a compact label with a dot, for a color name or a person's name.
 *
 * All three are decoration: they are hidden from assistive technology, and the name or color NAME printed beside them carries the meaning, so
 * color is never the only cue. No color gives a neutral gray look (dashed edge on a mark or chip), never a stored color. The colors come from
 * the `--mc-*` tokens, which switch to lighter variants in dark themes (src/ui/tokens.css), so these work in every palette, light and dark.
 */

/** Class names, exported so a test (or a caller that cannot use the component) gets the same ones. */
export const memberMarkClass = (size: MemberMarkSize = 'md', colorId?: MemberColorId | null) => `ui-mark ui-mark--${size}${colorId ? '' : ' ui-mark--none'}`;
export const memberDotClass = (colorId?: MemberColorId | null) => `ui-mdot${colorId ? '' : ' ui-mdot--none'}`;
export const memberChipClass = (colorId?: MemberColorId | null) => `ui-mchip${colorId ? '' : ' ui-mchip--none'}`;

export function MemberMark({ name, colorId, size = 'md' }: { name?: string | null; colorId?: MemberColorId | null; size?: MemberMarkSize }) {
  return <span className={memberMarkClass(size, colorId)} data-mc={colorId ?? undefined} aria-hidden="true">{memberInitials(name) || '?'}</span>;
}

export function MemberDot({ colorId }: { colorId?: MemberColorId | null }) {
  return <span className={memberDotClass(colorId)} data-mc={colorId ?? undefined} aria-hidden="true" />;
}

export function MemberChip({ colorId, children }: { colorId?: MemberColorId | null; children: ReactNode }) {
  return (
    <span className={memberChipClass(colorId)} data-mc={colorId ?? undefined}>
      <MemberDot colorId={colorId} />
      {children}
    </span>
  );
}
