import { registerModule } from '../core/registry';
import { calendarModule } from './calendar';
import { ledgerModule } from './ledger';
import { tasksModule } from './tasks';

let done = false;
/** Lists every module the app has. A new module is added by registering it here. Ledger stays first (the app opens there by default). */
export function registerModules() {
  if (done) return;
  done = true;
  registerModule(ledgerModule);
  registerModule(calendarModule);
  registerModule(tasksModule);
}
