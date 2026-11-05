/** Things any screen can ask the app shell to do, without importing the shell. */
export const OPEN_SEARCH_EVENT = 'ledger:open-search';
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

/** Opens the Add box. `dest` is a destination id (`task`, `event`, `transaction`, `scheduled`); `text` is what to start the box with. */
export const OPEN_ADD_EVENT = 'ledger:open-add';
export interface AddBoxRequest {
  dest?: string;
  text?: string;
}
export const openAddBox = (req: AddBoxRequest = {}) => window.dispatchEvent(new CustomEvent<AddBoxRequest>(OPEN_ADD_EVENT, { detail: req }));
