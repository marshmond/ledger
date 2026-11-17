/**
 * CS-2: the only display-publishing code in the app's entry chunk. It checks, without loading anything else, whether publishing is set up on this
 * device, and only then loads the publisher (which is large: it reads every module). A device that never publishes pays nothing.
 */
import { CONFIG_KEY } from './keys';

export function startDisplayPublisher(): void {
  try { if (!localStorage.getItem(CONFIG_KEY)) return; } catch { return; }
  void import('./runner').then((m) => m.startDisplayPublisher()).catch(() => undefined);
}
