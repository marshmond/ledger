import { useEffect, useState } from 'react';
import { todayISO } from '../lib/money';

/**
 * Today's date ('YYYY-MM-DD', local time) that updates itself when the day changes, so a screen left open overnight (or a phone
 * woken in the morning) does not keep showing yesterday. Checks every 30 seconds and whenever the page becomes visible again.
 */
export function useToday(everyMs = 30_000): string {
  const [day, setDay] = useState(todayISO);
  useEffect(() => {
    const check = () => setDay((cur) => { const now = todayISO(); return now === cur ? cur : now; });
    const t = setInterval(check, everyMs);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', check); };
  }, [everyMs]);
  return day;
}
