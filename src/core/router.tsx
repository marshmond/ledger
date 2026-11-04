/**
 * The only place module pages should get Link, NavLink, useNavigate and useLocation from. Inside a module they work exactly like
 * React Router's, except an address written as `/budget` becomes `/ledger/budget` (the module's prefix is added), and
 * `useLocation().pathname` comes back without the prefix. A test checks that no page imports these from react-router-dom directly.
 */
import { createContext, forwardRef, useCallback, useContext } from 'react';
import {
  Link as RLink, NavLink as RNavLink, useLocation as useRLocation, useNavigate as useRNavigate,
  type LinkProps, type NavLinkProps, type NavigateOptions, type To,
} from 'react-router-dom';
import { stripBasePath, withBasePath } from './paths';

const BaseContext = createContext('');
/** Wraps a module's pages and tells them where the module lives, e.g. value="/ledger". */
export const ModuleBase = BaseContext.Provider;
export const useModuleBase = () => useContext(BaseContext);

function withBase(base: string, to: To): To {
  if (typeof to === 'string') return withBasePath(base, to);
  return to.pathname ? { ...to, pathname: withBasePath(base, to.pathname) } : to;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
  return <RLink ref={ref} to={withBase(useModuleBase(), to)} {...rest} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink({ to, ...rest }, ref) {
  return <RNavLink ref={ref} to={withBase(useModuleBase(), to)} {...rest} />;
});

export function useNavigate() {
  const nav = useRNavigate();
  const base = useModuleBase();
  return useCallback((to: To | number, options?: NavigateOptions) => (typeof to === 'number' ? nav(to) : nav(withBase(base, to), options)), [nav, base]);
}

export function useLocation() {
  const loc = useRLocation();
  const base = useModuleBase();
  return base ? { ...loc, pathname: stripBasePath(base, loc.pathname) } : loc;
}
