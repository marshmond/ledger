# How Ledger syncs between devices (plain language)

## How it works
- Each device keeps its own full copy of the data in the browser. There is no account, no server of ours, and no Google involved.
- To keep copies in step, the app turns the whole database into one file, compresses it, **encrypts it on the device with your sync passphrase**, and stores it as a single file (`ledger-sync.bin`) in a **private GitHub repository you own**. GitHub only ever sees scrambled data. The device needs a GitHub token (permission: Contents, read and write, for that one repository) and the passphrase. Both stay in that browser only.
- A device syncs when the app opens, when you come back to its tab, when it goes online, a few seconds after you change something, and every five minutes while open. "Sync now" does it on demand.
- A sync reads the file, **merges it with this device's data record by record**, writes the merged result back, and remembers which records existed afterwards.
- **Everything in the database is covered**, because the sync walks every table. That includes Ledger's tables and the shared tables added in Phase 1 (contacts, tags, attachments, links, due items, per-module records). A later module's data syncs the same way with no sync changes, as long as it lives in the same database and its records have an `id` and `updatedAt` (the shared store does this for you).

## How conflicts are handled
- A record that exists on one device only is added to the other.
- If both devices changed the same record since the last sync, **the later edit wins** and **the other version is saved** in the "Edits that lost a tie" list on the Sync page (and the top bar shows "Review N"). A "Put that version back" button re-applies it as a new edit that then reaches every device. Nothing is silently lost.
- Deleted on one device and edited on the other: the deletion stands, and the edit is saved the same way.
- Deleting is noticed by comparing with the list of records from the last sync; the deletion is remembered for a year. Shared-store records use a soft delete (a `deletedAt` marker), which syncs like any other edit.
- A restored backup counts as an edit made now, so it wins and replaces the data on your other devices at their next sync (records the backup does not contain are removed there).

## What it does not do
- It is not field-level: if two devices edit different fields of the same record, the later whole record wins (the other is saved as above).
- It relies on each device's clock being roughly right. A device with a badly wrong clock can win or lose ties wrongly.
- A device offline for more than a year could bring back something deleted in the meantime.
- Edits made on two devices at the same instant are resolved by the later timestamp; the other is in the saved list.
- Sync is not a backup. Keep exporting backups. The automatic safety copies below are on one device only.
- The price-lookup key is never synced.

## Safety nets added in Phase 1
- **First sync on a new device** never merges blindly. You choose "upload this device's data" (the main device) or "use the synced copy" (a new device). Using the synced copy replaces the new device's own data, after an automatic full copy is saved on that device (see the Sync page, "Automatic safety copies").
- **Before the first sync after the shared-store update**, each device saves a full local snapshot automatically (the same format as Export backup). If that cannot be saved, sync pauses with a message instead of going ahead.
- Phase 0's manual **Export / Import backup** stays independent of sync.

## Risks with two devices editing at once, and how this limits them
| Risk | What limits it |
|---|---|
| Two devices change the same record | Later edit wins; the other version is saved and restorable. |
| Both devices sync at the same instant | The file is written only if nobody changed it meanwhile; otherwise the device re-reads and merges again (up to three tries), then shows a plain error. |
| A device is wiped by mistake when joining | Replacing needs a tick box, and a local safety copy is saved first. |
| A restore on one device overwrites the others | Stated on the Import screen when sync is on; the Pre-Import copy and the other devices' own backups remain. |
| Wrong passphrase on a new device | The file cannot be decrypted; nothing is changed. |
| A bug in a merge | The first-sync snapshot, the before-replace copy, Phase 0 exports and the weekly encrypted backup all exist outside the merge. |
