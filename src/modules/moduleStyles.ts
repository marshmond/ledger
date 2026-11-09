/**
 * Every module's stylesheet, loaded with the first download in the SAME order the single bundle always used (calendar, assets, bills,
 * household, projects, services, tasks, today; the app's own `styles.css` comes last, from main.tsx). A module's screens load on demand
 * (`src/core/lazyModule.ts`), but its styles do not: the whole stylesheet is 19 KB compressed, Today's cards use classes from several
 * modules, and keeping one sheet in one order means the cascade, and so every screen's look, is exactly what it was.
 */
import './calendar/calendar.css';
import './assets/assets.css';
import './assets/h3.css';
import './bills/bills.css';
import './contacts/contacts.css';
import './family/family.css';
import './household/household.css';
import './projects/projects.css';
import './services/services.css';
import './tasks/tasks.css';
import './today/today.css';
