/**
 * D21.1: the colors of the pre-D21.1 palettes (Classic and the four older presets), kept ONLY as test fixtures.
 * Nothing in the app imports this file. It exists so tests can prove that a custom theme or saved theme that was started from one of them still
 * renders through the universal Signature interface readably (`deriveExtras`), and that an older stored choice is read as the palette it maps to.
 * The app itself no longer has a Classic look or these four presets (see docs/LEDGER-SIGNATURE-D21.1-REPORT.md, section 8).
 */
import type { Colors } from '../palette';

export const CLASSIC: { light: Colors; dark: Colors } = {
  light: { bg: '#FFFFFF', card: '#F8F9FB', fg: '#1C2024', muted: '#5D6779', line: '#E4E7EC', accent: '#1A5FD0', pos: '#187636', neg: '#C02424', warn: '#8C5200', sideBg: '#F8F9FB', sideFg: '#1C2024', sideActive: '#1A5FD0' },
  dark: { bg: '#12151A', card: '#1A1E25', fg: '#E8EAED', muted: '#98A2B3', line: '#2A2F38', accent: '#5B9BFF', pos: '#56D364', neg: '#FF7B72', warn: '#E3B341', sideBg: '#1A1E25', sideFg: '#E8EAED', sideActive: '#5B9BFF' },
};

export const LEGACY_PRESETS: { id: 'teal' | 'navy' | 'forest' | 'slate'; name: string; light: Colors; dark: Colors }[] = [
  {
    id: 'teal', name: 'Calm teal',
    light: { bg: '#FAFAF8', card: '#F1F4F2', fg: '#1B2421', muted: '#566761', line: '#DCE4E0', accent: '#0F766E', pos: '#15803D', neg: '#B91C1C', warn: '#B45309', sideBg: '#EDF2EF', sideFg: '#1B2421', sideActive: '#0F766E' },
    dark: { bg: '#101614', card: '#18211E', fg: '#E6EEEA', muted: '#9DB0A8', line: '#26332F', accent: '#2DD4BF', pos: '#4ADE80', neg: '#F87171', warn: '#FBBF24', sideBg: '#0C1210', sideFg: '#E6EEEA', sideActive: '#2DD4BF' },
  },
  {
    id: 'navy', name: 'Deep navy and gold',
    light: { bg: '#FFFFFF', card: '#F4F6FA', fg: '#14213D', muted: '#555F7A', line: '#DFE3EC', accent: '#1E3A8A', pos: '#166534', neg: '#B91C1C', warn: '#8A6508', sideBg: '#14213D', sideFg: '#E8ECF4', sideActive: '#E9C46A' },
    dark: { bg: '#0E1420', card: '#161E2E', fg: '#E8ECF4', muted: '#A2AEC8', line: '#25304A', accent: '#7DA2FF', pos: '#4ADE80', neg: '#F87171', warn: '#E9C46A', sideBg: '#0A0F19', sideFg: '#E8ECF4', sideActive: '#E9C46A' },
  },
  {
    id: 'forest', name: 'Forest green and stone',
    light: { bg: '#FBFAF7', card: '#F2F0EA', fg: '#22251F', muted: '#5C6155', line: '#E1DED3', accent: '#2F6B3A', pos: '#2F6B3A', neg: '#B3261E', warn: '#9A5805', sideBg: '#EFEBE0', sideFg: '#22251F', sideActive: '#2F6B3A' },
    dark: { bg: '#131512', card: '#1C1F1B', fg: '#E9ECE5', muted: '#A3AA9B', line: '#2B2F28', accent: '#6FCF83', pos: '#6FCF83', neg: '#F2A29B', warn: '#E8B44A', sideBg: '#0E100D', sideFg: '#E9ECE5', sideActive: '#6FCF83' },
  },
  {
    id: 'slate', name: 'Slate and indigo',
    light: { bg: '#FFFFFF', card: '#F5F6F8', fg: '#1A1D24', muted: '#585F6C', line: '#E3E6EB', accent: '#4F46E5', pos: '#15803D', neg: '#B91C1C', warn: '#B45309', sideBg: '#F1F2F5', sideFg: '#1A1D24', sideActive: '#4F46E5' },
    dark: { bg: '#0F1115', card: '#171A21', fg: '#E7E9EE', muted: '#A0A7B4', line: '#272B35', accent: '#8B93FF', pos: '#4ADE80', neg: '#F87171', warn: '#FBBF24', sideBg: '#0B0D11', sideFg: '#E7E9EE', sideActive: '#8B93FF' },
  },
];
