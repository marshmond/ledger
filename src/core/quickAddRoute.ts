/**
 * Which destination did the typed text ask for? Pure routing for the Add box.
 * Text starting with a destination's shortcut and then a space picks it ("t buy milk", "e lunch fri", "$ coffee"). The whole-word
 * forms work too ("task buy milk", "event ...", "txn ..."), with an optional colon ("task: buy milk"). Anything else picks nothing:
 * the box never guesses, it asks.
 */
export interface RouteDef {
  id: string;
  prefix: string;
  aliases?: string[];
}

export interface Route<T extends RouteDef> {
  /** The destination the text asked for, or null. */
  def: T | null;
  /** The text with the shortcut removed (or the text unchanged when there was none). */
  rest: string;
}

export function routeQuickAdd<T extends RouteDef>(text: string, defs: readonly T[]): Route<T> {
  const m = /^\s*(\S+?):?\s+([\s\S]*)$/.exec(text);
  if (m) {
    const word = m[1].toLowerCase();
    const def = defs.find((d) => d.prefix.toLowerCase() === word || (d.aliases ?? []).some((a) => a.toLowerCase() === word));
    if (def) return { def, rest: m[2] };
  }
  return { def: null, rest: text };
}

/** "t buy milk" (typed, but meant as an event) becomes "buy milk"; text with no shortcut is unchanged. */
export const stripShortcut = <T extends RouteDef>(text: string, defs: readonly T[]): string => routeQuickAdd(text, defs).rest;
