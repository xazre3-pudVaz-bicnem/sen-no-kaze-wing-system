import { getSessionUser } from '@/lib/auth/session';
import { LP_NAV } from '@/data/site-content';
import { canEditDealerItems } from '@/lib/domain/types';
import { HeaderShell } from './header-shell';

export const NAV_ITEMS = LP_NAV;

export async function Header() {
  const user = await getSessionUser();
  // 代理店以上は管理画面が主戦場なので、そちらを既定の導線にする
  const isStaff = canEditDealerItems(user?.role);
  return (
    <HeaderShell
      items={LP_NAV}
      user={user ? { name: user.full_name || user.email, isAdmin: isStaff } : null}
    />
  );
}
