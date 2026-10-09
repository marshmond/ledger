import type { FinanceDB } from '../db';

export interface BackupFile {
  /** 1 = Phase 1 data only; 2 adds budget and recurring items; 3 adds income/payroll data; 4 adds investments; 5 adds goals and windfalls; 6 adds loans. */
  version: 1 | 2 | 3 | 4 | 5 | 6;
  exportedAt: string;
  accounts: unknown[];
  categoryGroups: unknown[];
  categories: unknown[];
  txns: unknown[];
  importBatches: unknown[];
  assignments?: unknown[];
  recurring?: unknown[];
  recurringLog?: unknown[];
  people?: unknown[];
  incomeProfiles?: unknown[];
  bonuses?: unknown[];
  taxSettings?: unknown[];
  invAccounts?: unknown[];
  assetClasses?: unknown[];
  securities?: unknown[];
  holdings?: unknown[];
  settings?: unknown[];
  windfalls?: unknown[];
  goals?: unknown[];
  loans?: unknown[];
  loanRates?: unknown[];
  loanEvents?: unknown[];
}

export async function exportAll(d: FinanceDB): Promise<BackupFile> {
  return {
    version: 6,
    exportedAt: new Date().toISOString(),
    accounts: await d.accounts.toArray(),
    categoryGroups: await d.categoryGroups.toArray(),
    categories: await d.categories.toArray(),
    txns: await d.txns.toArray(),
    importBatches: await d.importBatches.toArray(),
    assignments: await d.assignments.toArray(),
    recurring: await d.recurring.toArray(),
    recurringLog: await d.recurringLog.toArray(),
    people: await d.people.toArray(),
    incomeProfiles: await d.incomeProfiles.toArray(),
    bonuses: await d.bonuses.toArray(),
    taxSettings: await d.taxSettings.toArray(),
    invAccounts: await d.invAccounts.toArray(),
    assetClasses: await d.assetClasses.toArray(),
    securities: await d.securities.toArray(),
    holdings: await d.holdings.toArray(),
    // The market-data API key is never exported: backups can be shared or stored in the cloud.
    settings: (await d.settings.toArray()).filter((s) => s.key !== 'priceApiKey'),
    windfalls: await d.windfalls.toArray(),
    goals: await d.goals.toArray(),
    loans: await d.loans.toArray(),
    loanRates: await d.loanRates.toArray(),
    loanEvents: await d.loanEvents.toArray(),
  };
}

/** Replaces ALL data with the backup's contents. Older (version 1) backups restore with an empty budget. */
export async function importAll(d: FinanceDB, b: BackupFile) {
  if (![1, 2, 3, 4, 5, 6].includes(b.version)) throw new Error('Unsupported backup version');
  const tables = [d.accounts, d.categoryGroups, d.categories, d.txns, d.importBatches, d.assignments, d.recurring, d.recurringLog, d.people, d.incomeProfiles, d.bonuses, d.taxSettings, d.invAccounts, d.assetClasses, d.securities, d.holdings, d.settings, d.windfalls, d.goals, d.loans, d.loanRates, d.loanEvents];
  await d.transaction('rw', tables, async () => {
    // The API key lives only on this device (never in backups), so a restore must not wipe it.
    const apiKey = await d.settings.get('priceApiKey');
    await Promise.all(tables.map((t) => t.clear()));
    await d.accounts.bulkAdd(b.accounts as never[]);
    await d.categoryGroups.bulkAdd(b.categoryGroups as never[]);
    await d.categories.bulkAdd(b.categories as never[]);
    await d.txns.bulkAdd(b.txns as never[]);
    await d.importBatches.bulkAdd(b.importBatches as never[]);
    await d.assignments.bulkAdd((b.assignments ?? []) as never[]);
    await d.recurring.bulkAdd((b.recurring ?? []) as never[]);
    await d.recurringLog.bulkAdd((b.recurringLog ?? []) as never[]);
    await d.people.bulkAdd((b.people ?? []) as never[]);
    await d.incomeProfiles.bulkAdd((b.incomeProfiles ?? []) as never[]);
    await d.bonuses.bulkAdd((b.bonuses ?? []) as never[]);
    await d.taxSettings.bulkAdd((b.taxSettings ?? []) as never[]);
    await d.invAccounts.bulkAdd((b.invAccounts ?? []) as never[]);
    await d.assetClasses.bulkAdd((b.assetClasses ?? []) as never[]);
    await d.securities.bulkAdd((b.securities ?? []) as never[]);
    await d.holdings.bulkAdd((b.holdings ?? []) as never[]);
    await d.settings.bulkAdd((b.settings ?? []) as never[]);
    await d.windfalls.bulkAdd((b.windfalls ?? []) as never[]);
    await d.goals.bulkAdd((b.goals ?? []) as never[]);
    await d.loans.bulkAdd((b.loans ?? []) as never[]);
    await d.loanRates.bulkAdd((b.loanRates ?? []) as never[]);
    await d.loanEvents.bulkAdd((b.loanEvents ?? []) as never[]);
    if (apiKey) await d.settings.put(apiKey);
  });
}

// ---- passphrase encryption (PBKDF2 -> AES-GCM) so backups are safe to store anywhere ----

const b64 = (u: Uint8Array) => {
  let s = '';
  u.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(text: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await deriveKey(pass, salt),
    new TextEncoder().encode(text),
  );
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
}

export async function decryptText(payload: string, pass: string): Promise<string> {
  const p = JSON.parse(payload);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(p.iv) as BufferSource },
      await deriveKey(pass, unb64(p.salt)),
      unb64(p.data) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
}
