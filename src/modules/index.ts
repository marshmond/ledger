import { registerModule } from '../core/registry';
import './moduleStyles';
import { calendarModule } from './calendar';
import { ledgerModule } from './ledger';
import { assetsModule } from './assets';
import { billsModule } from './bills';
import { householdModule } from './household';
import { projectsModule } from './projects';
import { servicesModule } from './services';
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
  registerModule(assetsModule);
  registerModule(servicesModule);
  registerModule(billsModule);
  registerModule(householdModule);
}
