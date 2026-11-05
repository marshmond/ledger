/** Things any screen can ask the app shell to do, without importing the shell. */
export const OPEN_SEARCH_EVENT = 'ledger:open-search';
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
