import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { CaseManagementNav } from '@/components/admin/case-management-nav';
import { CaseWorkspace } from '@/components/admin/case-workspace';
import { ROLE_LABELS } from '@/lib/domain/types';

export default async function AdminQuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireStaff();

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/quotes" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← 案件一覧へ戻る
        </Link>
        <span className="rounded-lg bg-[#edf3f6] px-3 py-2 text-xs font-semibold text-[#365467]">{ROLE_LABELS[actor.role]}</span>
      </div>
      <CaseManagementNav role={actor.role} active="cases" />
      <CaseWorkspace
        quoteId={id}
        actor={actor}
        tab={sp.tab}
        created={sp.created}
        from={sp.from}
      />
    </div>
  );
}
