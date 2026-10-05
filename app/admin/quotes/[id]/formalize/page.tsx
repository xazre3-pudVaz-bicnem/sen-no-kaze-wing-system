import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { isCurrentAcceptedPreliminaryForFormalization } from '@/lib/domain/quote-lifecycle';
import { formatYen } from '@/lib/domain/pricing';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { LegacyAcceptedFormalizationForm } from '@/components/admin/legacy-accepted-formalization-form';
import { QuoteTable } from '@/components/mypage/quote-table';
import { Badge } from '@/components/ui';

export default async function LegacyAcceptedFormalizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const store = await getStore();
  const detail = await store.getQuote(id, actor);
  if (!detail) notFound();

  const { quote, items, request } = detail;
  const canAccess = actor.role === 'admin' || quote.dealer_id === actor.id;
  const webIdentityConsistent =
    quote.configuration_id !== null &&
    quote.user_id !== null &&
    quote.dealer_id !== null &&
    request?.configuration_id === quote.configuration_id &&
    request?.user_id === quote.user_id;

  // UI is fail-closed. The RPC repeats and strengthens all checks under lock.
  if (!canAccess || !webIdentityConsistent || !isCurrentAcceptedPreliminaryForFormalization(quote, request)) {
    notFound();
  }

  const installationItems = items
    .filter((item) => item.kind === 'installation')
    .sort((a, b) => a.sort_order - b.sort_order);
  const returnHref = `/admin/quotes?case=${encodeURIComponent(quote.id)}&tab=estimate#case-workspace`;

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-3" data-testid="legacy-accepted-formalization-page">
      <section className="overflow-hidden rounded-lg border border-[#2b5d48] bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 bg-[#245c45] px-4 py-3 text-white">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">施工金額を反映して確定見積を作成</h1>
              <Badge tone="neutral">概算承諾済み</Badge>
            </div>
            <p className="mt-1 text-xs text-white/80">
              承諾済み概算を履歴として残したまま、現地確認後の施工金額を新しい確定見積へ反映します。
            </p>
          </div>
          <Link href={returnHref} className="rounded-md border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
            案件へ戻る
          </Link>
        </div>

        <div className="grid gap-2 border-t border-white/10 bg-[#f7faf8] px-4 py-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <div><span className="text-muted">見積番号</span><strong className="ml-1">{quote.quote_no}</strong></div>
          <div><span className="text-muted">版</span><strong className="ml-1">第{quote.revision}版 → 第{quote.revision + 1}版</strong></div>
          <div><span className="text-muted">状態</span><strong className="ml-1">{QUOTE_STATUS_LABELS[quote.status]}</strong></div>
          <div><span className="text-muted">現在の税込額</span><strong className="ml-1">{formatYen(quote.total)}</strong></div>
          <div><span className="text-muted">商品モデル</span><strong className="ml-1">{quote.base_model_name}</strong></div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line bg-[#fafbf9] px-3 py-2">
          <h2 className="text-sm font-semibold text-[#315745]">承諾済み概算見積（変更しません）</h2>
          <p className="mt-0.5 text-[0.68rem] text-muted">
            下記は履歴として固定されます。新しい確定見積はこのSnapshotを基準にDB側で作成します。
          </p>
        </div>
        <div className="overflow-x-auto">
          <QuoteTable quote={quote} items={items} showBaseDetail showSelectedImages={false} />
        </div>
      </section>

      <LegacyAcceptedFormalizationForm
        quoteId={quote.id}
        installationItems={installationItems}
        defaultDealerNote={quote.dealer_note}
      />
    </div>
  );
}
