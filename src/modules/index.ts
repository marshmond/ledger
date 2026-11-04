import { registerModule } from '../core/registry';
import { ledgerModule } from './ledger';

let done = false;
/** Lists every module the app has. A new module is added by registering it here. */
export function registerModules() {
  if (done) return;
  done = true;
  registerModule(ledgerModule);
}
