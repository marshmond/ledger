/** The palette's quick actions and how typed words pick them. Pure, so the word-splitting is tested. */
export interface PaletteAction { title: string; words: string; to?: string; run?: () => void }

/** Every typed word must appear in the action's title or keywords. Words are split on whitespace. */
export function filterActions<T extends { title: string; words: string }>(query: string, actions: readonly T[]): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return actions.filter((a) => words.every((w) => a.title.toLowerCase().includes(w) || a.words.includes(w)));
}
