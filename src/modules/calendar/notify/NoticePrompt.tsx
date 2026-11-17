import type { NoticeOffer } from './offers';

/**
 * CAL-N1: the small, non-blocking question after a save or a delete. It sits at the bottom of the screen and the Calendar stays fully usable behind it.
 * It writes nothing and sends nothing: "Choose people" opens the composer, "Not now" only records that the owner declined.
 */
export default function NoticePrompt({ offer, onChoose, onNotNow }: { offer: NoticeOffer; onChoose: () => void; onNotNow: () => void }) {
  const k = offer.subject.kind;
  const ask = k === 'cancelled' ? 'Let someone know it is cancelled?'
    : k === 'restored' ? 'Send a correction to the people who were told it was cancelled?'
    : 'Email someone about it?';
  return (
    <section className="cal-np" role="region" aria-label="Email about this event">
      <p className="cal-np-text"><strong>{offer.headline}</strong> {ask}</p>
      <div className="row cal-np-actions">
        <button type="button" className="btn" onClick={onNotNow}>Not now</button>
        <button type="button" className="btn primary" onClick={onChoose}>Choose people</button>
      </div>
    </section>
  );
}
