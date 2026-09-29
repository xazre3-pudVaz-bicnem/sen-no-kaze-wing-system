import Link from 'next/link';

export function QuoteManagementTabs({ active }: { active: 'case' | 'standard' }) {
  const baseClass =
    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors';

  return (
    <nav
      aria-label="見積書管理の種類"
      className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1 shadow-sm"
    >
      <Link
        href="/admin/quotes/new"
        aria-current={active === 'case' ? 'page' : undefined}
        className={
          active === 'case'
            ? baseClass + ' bg-ink text-white'
            : baseClass + ' text-ink-soft hover:bg-sand'
        }
      >
        案件見積
      </Link>
      <Link
        href="/admin/estimate-templates"
        aria-current={active === 'standard' ? 'page' : undefined}
        className={
          active === 'standard'
            ? baseClass + ' bg-ink text-white'
            : baseClass + ' text-ink-soft hover:bg-sand'
        }
      >
        シミュレーター標準
      </Link>
    </nav>
  );
}
