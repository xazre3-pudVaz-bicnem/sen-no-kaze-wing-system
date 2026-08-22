import { getSessionUser } from '@/lib/auth/session';
import { LP_NAV } from '@/data/site-content';
import { HeaderShell } from './header-shell';

export const NAV_ITEMS = LP_NAV;

export async function Header() {
  const user = await getSessionUser();
  return <HeaderShell items={LP_NAV} user={user ? { name: user.full_name || user.email, isAdmin: user.role === 'admin' } : null} />;
}
