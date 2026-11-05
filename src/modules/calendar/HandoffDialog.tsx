import type { EventHandoff, EventSeed, HandoffResult } from '../../core/registry';
import Modal from '../../shell/Modal';

/**
 * The dialog around another module's "create this from an event" form (Ledger's scheduled-item form, today). The module draws the
 * form and does its own confirming; this only frames it and says what happens to the calendar event afterwards.
 */
export default function HandoffDialog({ handoff, seed, replacing, onCreated, onClose }: {
  handoff: EventHandoff; seed: EventSeed; /** True when an existing calendar event will be retired once the module has created its item. */ replacing: boolean;
  onCreated: (r: HandoffResult) => void; onClose: () => void;
}) {
  const consequence = replacing
    ? `${handoff.ownerName} will own this item from now on. This calendar event will be removed from your calendar so it is not listed twice (it is kept out of sight with a note pointing to the new item). Single dates you skipped or changed here do not carry over.`
    : `${handoff.ownerName} will own this item from now on. Nothing is added to your calendar by hand: it shows up on the Finance layer, worked out by ${handoff.ownerName}.`;
  const Form = handoff.Form;
  return (
    <Modal title={handoff.label} onClose={onClose} wide>
      <Form seed={seed} consequence={consequence} onCreated={onCreated} onCancel={onClose} />
    </Modal>
  );
}
