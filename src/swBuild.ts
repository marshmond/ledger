/**
 * Build-time helpers for the service worker (public/sw.js). Pure, so they are tested without a build.
 *
 * Why this exists (ST-S4, SE-03 and PF-01): the worker file used to be identical in every release, so the browser never updated it, it kept
 * one cache forever and added every new hashed file to it. And once the screens load on demand, installing the worker must save every
 * screen file, or a module that was never opened before going offline would not open. The build knows the exact list of files, so it
 * writes that list, and a short fingerprint of the build, into the worker. The fingerprint also makes the worker file differ in every
 * release, which is what makes the browser install the new one.
 */
import { createHash } from 'node:crypto';

/** The text in public/sw.js the build replaces. */
export const BUILD_MARKER = "'__LEDGER_BUILD__'";
export const FILES_MARKER = /\/\*LEDGER_FILES\*\/[\s\S]*?\/\*END_LEDGER_FILES\*\//;

/** Files to save for offline use: the built scripts and styles, as `./assets/...` (relative to the worker, like the rest of its list). */
export function precacheList(emitted: readonly string[]): string[] {
  return emitted
    .filter((f) => /^assets\/.+\.(?:js|css)$/.test(f))
    .map((f) => `./${f}`)
    .sort();
}

/** A short fingerprint of everything the worker saves: changes whenever any saved file changes, otherwise stays the same. */
export function buildId(parts: Readonly<Record<string, string | Uint8Array>>): string {
  const h = createHash('sha256');
  for (const name of Object.keys(parts).sort()) {
    h.update(name).update('\0').update(parts[name]).update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** Fills the build id and file list into the worker's source. Throws if the worker no longer has the places to fill, so a release cannot go out with a constant cache. */
export function injectBuild(source: string, id: string, files: readonly string[]): string {
  if (!source.includes(BUILD_MARKER) || !FILES_MARKER.test(source)) {
    throw new Error('public/sw.js is missing the build id or file list placeholder; the service worker would never update.');
  }
  return source
    .replace(BUILD_MARKER, JSON.stringify(id).replace(/"/g, "'"))
    .replace(FILES_MARKER, () => `/*LEDGER_FILES*/ ${JSON.stringify(files)} /*END_LEDGER_FILES*/`);
}
