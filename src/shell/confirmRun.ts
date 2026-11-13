/**
 * D20: the "press the action" logic of `ConfirmDialog`, as a plain function so it can be tested without a browser. Behaviour is exactly what the dialog did before it was moved here:
 *  - a second press while the first is still running does nothing (no duplicate action);
 *  - the dialog is marked busy while it runs, and an earlier error is cleared;
 *  - the handler may refuse by returning a message, or by throwing; the message is shown and the dialog stays open;
 *  - the handler returning nothing / true is a success (the caller closes the dialog); nothing here ever closes it;
 *  - it is always free to be pressed again afterwards (a refusal is not a lock-out).
 * It reads the handler through `getHandler`, so it always runs the newest one the caller gave the dialog.
 */
export type ConfirmHandler = () => Promise<string | void | boolean> | string | void | boolean;

export interface ConfirmRunnerHooks { setBusy(busy: boolean): void; setError(message: string | null): void }

export interface ConfirmRunner {
  /** True from the moment the action starts until it has finished (the dialog uses it to refuse Escape and a click outside). */
  readonly running: boolean;
  go(): Promise<void>;
}

export function makeConfirmRunner(getHandler: () => ConfirmHandler, hooks: ConfirmRunnerHooks): ConfirmRunner {
  let running = false;
  return {
    get running() { return running; },
    async go() {
      if (running) return;
      running = true;
      hooks.setBusy(true);
      hooks.setError(null);
      try {
        const r = await getHandler()();
        if (typeof r === 'string') hooks.setError(r);
      } catch (e) {
        hooks.setError(e instanceof Error ? e.message : 'Nothing was changed.');
      } finally {
        running = false;
        hooks.setBusy(false);
      }
    },
  };
}
