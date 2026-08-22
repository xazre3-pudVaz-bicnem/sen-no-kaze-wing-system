import { getSessionUser } from '@/lib/auth/session';
import { HeaderShell } from './header-shell';

export const NAV_ITEMS = [
  { href: '/#about', label: 'Wingとは' },
  { href: '/#brands', label: 'ブランド' },
  { href: '/products', label: '商品' },
  { href: '/#install', label: '設置の流れ' },
  { href: '/contact', label: 'お問い合わせ' },
];

export async function Header() {
  const user = await getSessionUser();
  return <HeaderShell items={NAV_ITEMS} user={user ? { name: user.full_name || user.email, isAdmin: user.role === 'admin' } : null} />;
}
