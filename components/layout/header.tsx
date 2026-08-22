import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { PROJECT_NAME } from '@/lib/site';
import { HeaderNav } from './header-nav';

export const NAV_ITEMS = [
  { href: '/#about', label: 'Wingとは' },
  { href: '/products', label: '商品一覧' },
  { href: '/#cases', label: '施工事例' },
  { href: '/#flow', label: '導入の流れ' },
  { href: '/#faq', label: 'よくある質問' },
  { href: '/contact', label: 'お問い合わせ' },
];

export async function Header() {
  const user = await getSessionUser();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/90 backdrop-blur-md">
      <div className="container-x flex h-16 items-center justify-between gap-4 sm:h-20">
        <Link href="/" className="flex items-baseline gap-2.5" aria-label="Wing トップページ">
          <span className="font-serif text-2xl font-semibold tracking-[0.08em] text-ink sm:text-[1.7rem]">Wing</span>
          <span className="hidden text-[0.7rem] tracking-[0.2em] text-muted sm:inline">{PROJECT_NAME}</span>
        </Link>
        <HeaderNav items={NAV_ITEMS} user={user ? { name: user.full_name || user.email, isAdmin: user.role === 'admin' } : null} />
      </div>
    </header>
  );
}
