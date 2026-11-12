import { useEffect, useState } from 'react';

/** True while the browser matches a media query (for example `(max-width: 640px)`), updating when it changes. False where there is no matchMedia (a test, an old browser). */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const update = () => setOn(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return on;
}
