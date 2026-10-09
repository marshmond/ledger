import { useState } from 'react';
import { db } from '../db';
import { setManualPrice } from '../lib/prices';
import type { Security } from '../types';

/**
 * Editable price for a security. Saves on Enter or when leaving the box, rejects text that is not a price (and leaves the
 * stored price alone), and shows where the stored price came from. Prices belong to the ticker, so one entry prices
 * every account that holds it.
 */
export default function PriceCell({ sec }: { sec: Security }) {
  const shown = sec.priceCents != null ? (sec.priceCents / 100).toFixed(2) : '';
  const [text, setText] = useState(shown);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function commit() {
    if (text.trim() === shown) return setMsg(null);
    const r = await setManualPrice(db, sec.id!, text);
    if (!r.ok) {
      setMsg({ kind: 'error', text: r.error });
      setText(shown); // put the stored price back
      return;
    }
    setMsg({ kind: 'ok', text: r.cents === null ? 'Price cleared' : 'Saved' });
    setTimeout(() => setMsg(null), 2000);
  }

  return (
    <div>
      <input
        style={{ width: 92, textAlign: 'right' }}
        inputMode="decimal"
        value={text}
        placeholder="Enter price"
        aria-label={`Price for ${sec.ticker}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {msg ? (
        <div className={msg.kind === 'ok' ? 'ok' : 'error'} style={{ margin: 0, fontSize: '0.8rem' }}>{msg.text}</div>
      ) : (
        <div className="muted" style={{ fontSize: '0.75rem' }}>
          {sec.priceCents == null ? 'no price yet' : `${sec.priceSource === 'api' ? 'refreshed' : 'manual'} · ${sec.priceDate ?? ''}`}
        </div>
      )}
    </div>
  );
}
