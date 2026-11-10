import { useEffect } from 'react';
import { useLocation, useNavigate } from '../../core/router';
import { ADD_PARAM } from './quickAddDef';

/** Pure: which add form the address asks for (`?add=member` or `?add=date`), or null. Anything else is ignored. */
export function addIntentOf(search: string): string | null {
  return new URLSearchParams(search).get(ADD_PARAM);
}

/**
 * The Add box (and nothing else) sends people to `#/family?add=member` or `#/family/dates?add=date`. The page calls this with the value it answers to:
 * the first time it sees it, it opens ITS OWN add form and then tidies the address, so a refresh or the Back button does not open the form again.
 * It writes nothing: the form is the existing one and saves only when the person presses its own button.
 */
export function useAddIntent(which: string, open: () => void) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const wanted = addIntentOf(search) === which;
  useEffect(() => {
    if (!wanted) return;
    open();
    navigate(pathname || '/', { replace: true });
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
}
