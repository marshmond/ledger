import { registerModule } from '../core/registry';
import { calendarModule } from './calendar';
import { ledgerModule } from './ledger';
import { projectsModule } from './projects';
import { tasksModule } from './tasks';
import { todayModule } from './today';

let done = false;
/** Lists every module the app has. A new module is added by registering it here. Today is first: it is where the app opens by default. */
export function registerModules() {
  if (done) return;
  done = true;
  registerModule(todayModule);
  registerModule(ledgerModule);
  registerModule(calendarModule);
  registerModule(tasksModule);
  registerModule(projectsModule);
}
