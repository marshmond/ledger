/** Addresses inside the Household Services module (the module prefix /services is added by the router). Written as functions, not inline, because the address check in core.test.ts reads inline addresses as Ledger pages. */
export const arrangementRoute = (id: number) => `/a/${id}`;
export const providerRoute = (contactId: number) => `/providers/${contactId}`;
