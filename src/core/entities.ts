/**
 * Shapes of the records every module shares. Ledger's own records (accounts, transactions, ...) are unchanged and live in src/types.ts.
 * Every shared record carries: a unique id, when it was created, when it was last changed, and (if removed) when it was
 * deleted. "Deleted" records stay in the database as a marker so that deleting on one device can reach the others.
 */

export interface BaseRecord {
  /** Unique across devices (time-based, assigned by the store). */
  id?: number;
  createdAt: number;
  updatedAt: number;
  /** Set when the record is deleted. Normal reads skip these. */
  deletedAt?: number | null;
}

/** A person you know (family, a doctor, a landlord). Not the same as Ledger's household members, which drive tax math. */
export interface Contact extends BaseRecord {
  name: string;
  relationship?: string;
  notes?: string;
}

/** A label any module can put on its records. */
export interface Tag extends BaseRecord {
  name: string;
  color?: string;
}

/** Ids are numbers in Ledger; later modules may use text. */
export type RecordId = number | string;
export interface RecordRef {
  module: string;
  id: RecordId;
}

/** Describes a file kept with a record. Only the description is stored for now (no file contents yet). */
export interface Attachment extends BaseRecord {
  ownerModule: string;
  ownerId: RecordId;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Where the bytes will live once attachments are built. 'none' = description only. */
  storage: 'none';
}

/** "This record in one module is connected to that record in another." */
export interface Link extends BaseRecord {
  fromModule: string;
  fromId: RecordId;
  toModule: string;
  toId: RecordId;
  /** What the connection means, e.g. 'about', 'paid-for', 'attached'. Free text agreed between modules. */
  type: string;
}

export type Priority = 'high' | 'medium' | 'low' | 'reminder';
export type DueStatus = 'open' | 'done' | 'skipped' | 'cancelled';

/**
 * Something with a date that a module wants to show on the shared calendar / task list (a bill due, a vest, an appointment).
 * Phase 2 will read these; for now modules can publish and retract them and nothing displays them.
 */
export interface DueItem extends BaseRecord {
  sourceModule: string;
  /** The record in the source module this is about; with sourceModule it identifies the item, so publishing twice updates it. */
  sourceRecordId: RecordId;
  title: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local time HH:MM when allDay is false. */
  time?: string;
  allDay: boolean;
  /** Repeat rule in iCalendar RRULE text (e.g. FREQ=MONTHLY), optional. Not interpreted yet. */
  recurrence?: string;
  priority: Priority;
  status: DueStatus;
  tagIds: number[];
}
export type DueItemInput = Omit<DueItem, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** A record in a module's own namespace (for modules that do not need their own database tables). */
export interface ModuleRecord extends BaseRecord {
  module: string;
  kind: string;
  data: Record<string, unknown>;
}
