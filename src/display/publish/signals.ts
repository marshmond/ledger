/**
 * CS-2: a tiny, dependency-free message channel from "a privacy decision was written" to "try to publish now". It exists so the decision
 * store (which Calendar and Tasks code already imports) does not have to import the publisher and everything it pulls in.
 */
let hideListener: (() => void) | null = null;
export const onHideDecision = (f: (() => void) | null) => { hideListener = f; };
/** A hide, or the "hide everything" switch, was written: the owner expects the display to follow without waiting. */
export const emitHideDecision = () => { const f = hideListener; if (f) setTimeout(f, 0); };
