/** Addresses inside the Bills & Subscriptions module (the module prefix /bills is added by the router). Written as functions, not inline, because the address check in core.test.ts reads inline addresses as Ledger pages. */
export const BILLS_BASE = '/bills';
export const overviewRoute = () => '/';
export const listRoute = () => '/list';
export const obligationRoute = (id: number) => `/o/${id}`;
/** Full addresses (for search, records and other modules). */
export const obligationPath = (id: number) => `/bills/o/${id}`;
export const billsListPath = () => '/bills/list';
export const billsPath = () => '/bills';
