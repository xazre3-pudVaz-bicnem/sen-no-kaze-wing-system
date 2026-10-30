import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getLegacyPriceScope, withLegacyOptionPrices } from '@/lib/data/legacy-prices';
import { isLocalMode } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { findUnresolvedLines, quoteOptionFlagMap, type QuoteLineCheckLine } from '@/lib/domain/quote-por';
import { standardQuoteStateFromPayload, type StandardQuoteDraftPayload } from '@/lib/domain/standard-quote-view';
import { createClient } from '@/lib/supabase/server';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { StandardQuoteEditor } from '@/components/admin/standard-quote-editor';

export const metadata: Metadata = { title: '標準見積から作成した見積下書き | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** 元の標準見積の版の明細（初回の下書きの金額未確定の判定に使う列だけ） */
type StandardBaselineRow = {
  section_code: string;
  name: string;
  group_label: string | null;
  remark: string | null;
  price_mode: string;
  cost_unit_price: number | null;
  unit_price: number | null;
};

/** 標準見積から作成した見積下書き（本部だけ）。率・内部原価は DB の RPC から読み、表へ直接は書き込まない */
export default async function StandardQuoteDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  await requireAdmin(`/admin/quotes/standard-drafts/${id}`);
  const sp = await searchParams;
  if (isLocalMode()) {
    return (
      <AdminPage title="見積下書き">
        <Alert tone="info">この画面はSupabase接続環境で利用できます。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_standard_quote_draft', { p_draft_id: id });
  if (error) {
    if (error.code === 'P0002' || error.message?.startsWith('NOT_FOUND')) notFound();
    return (
      <AdminPage title="見積下書き">
        <Alert tone="danger">{error.message.replace(/^[A-Z_]+:\s*/, '')}</Alert>
      </AdminPage>
    );
  }
  if (!data) notFound();
  const payload = data as StandardQuoteDraftPayload;
  const { draft, request, standard_estimate: source, parent, internals } = payload;
  // 金額が未確定の行（POR と、0 円の内外装・オプション・別途工事の行のうち、自動計算・前の版と同じ 0 円・0円確定・対象外のどれでもない行）。
  // 止めるのは DB の正式保存（D1 までの暫定）。前の版の明細は明細のキーで突き合わせる
  // 改訂の下書きは前の版、初回は元の標準見積の版の 0 円の行と突き合わせる（DB の assert_quote_draft_lines_resolved と同じ）
  const [parentRead, baselineRead] = await Promise.all([
    parent
      ? supabase.from('quote_items').select('line_key, kind, name, description, remark, unit_price, option_id').eq('quote_id', parent.id)
      : Promise.resolve({ data: [], error: null }),
    !parent && draft.standard_estimate_revision_id
      ? supabase
          .from('standard_estimate_revision_lines')
          .select('section_code, name, group_label, remark, price_mode, cost_unit_price, unit_price')
          .eq('revision_id', draft.standard_estimate_revision_id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // 前の版の明細が指す商品の別途見積の設定・台帳の価格（DB の判定と同じく、販売停止・非公開の商品も含む）。
  // 件数の上限で取りこぼさないよう、明細が指す商品だけを読む
  const parentOptionIds = [
    ...new Set(((parentRead.data ?? []) as { option_id?: string | null }[]).map((row) => row.option_id).filter((value): value is string => Boolean(value))),
  ];
  const optionsRead = parentOptionIds.length
    ? await supabase.from('options').select('id, price_on_request').in('id', parentOptionIds)
    : { data: [], error: null };
  // 台帳の価格（旧価格の列）は利用者のロールから読めない（v2.5 PR-C1b）。サーバーで足す（本部の画面）
  const pricedOptions = optionsRead.error
    ? []
    : await withLegacyOptionPrices((optionsRead.data ?? []) as { id: string; price_on_request: boolean }[], await getLegacyPriceScope());
  const parentReadFailed = Boolean(parentRead.error || baselineRead.error || optionsRead.error);
  const optionFlags = quoteOptionFlagMap(
    pricedOptions.map((option) => ({
      id: option.id,
      price: option.price,
      priceOnRequest: option.price_on_request,
    }))
  );
  const baselineKind: Record<string, string> = { interior_exterior: 'interior_exterior', option: 'option', sitework: 'installation' };
  const baselineLines: QuoteLineCheckLine[] = ((baselineRead.data ?? []) as StandardBaselineRow[])
    .filter((row) => Object.hasOwn(baselineKind, row.section_code))
    .filter((row) => (row.price_mode === 'auto' ? (row.cost_unit_price ?? 0) === 0 : row.price_mode === 'manual' && (row.unit_price ?? 0) === 0))
    .map((row) => ({
      kind: baselineKind[row.section_code],
      name: row.name,
      description: row.group_label,
      remark: row.remark,
      unit_price: 0,
    }));
  const unresolvedItems = parentReadFailed
    ? new Set<StandardQuoteDraftPayload['items'][number]>()
    : findUnresolvedLines(payload.items, {
        parentLines: (parentRead.data ?? []) as QuoteLineCheckLine[],
        baselineLines,
        options: optionFlags,
        matchLineKey: true,
      });
  const savedUnresolvedNames = payload.items
    .filter((item) => item.price_mode === 'por' || unresolvedItems.has(item))
    .map((item) => item.name);
  const customer = request.contact?.full_name ?? '';
  const targetRevision = parent ? parent.revision + 1 : 1;

  return (
    <AdminPage
      title={request.case_name?.trim() || customer || '見積下書き'}
      lead={`第${targetRevision}版 見積下書き（標準見積から作成）${customer ? ` ／ ${customer} 様` : ''}`}
      actions={<Badge tone="warn">下書き</Badge>}
    >
      <BackLink href="/admin/quotes" label="案件管理へ戻る" />
      {sp.created && <Alert tone="success">標準見積から見積下書きを作成しました。まだ正式な見積書は発行していません。</Alert>}
      {sp.revisionDraft && (
        <Alert tone="success">現在の発行済み見積をもとに、次の見積下書きを開きました。率・明細は発行済みの版から引き継いでいます（最新の標準見積へは追従しません）。</Alert>
      )}
      <section className="grid gap-2 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">保存済みの税込合計</p>
          <p className="font-semibold tabular-nums">{formatYen(draft.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">内部原価（本部だけ）</p>
          <p className="tabular-nums">{formatYen(internals?.cost_total ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">元の標準見積</p>
          <p>
            {source ? (
              <Link href={`/admin/standard-estimates/${source.revision_id}`} className="underline-offset-4 hover:underline">
                {source.name} 第{source.version}版
              </Link>
            ) : (
              '—'
            )}
            {source && source.current_published_revision_id && source.current_published_revision_id !== source.revision_id && (
              <span className="block text-xs text-muted">標準見積には新しい公開版があります（この見積は追従しません）</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">金額未確定の行</p>
          <p>
            {savedUnresolvedNames.length > 0 ? <Badge tone="warn">{savedUnresolvedNames.length} 行（発行できません）</Badge> : 'なし'}
            {parentReadFailed && <span className="block text-xs text-muted">前の版・元の標準見積の明細を読み取れなかったため、発行の可否は発行のときに確かめます</span>}
          </p>
        </div>
        {parent && (
          <p className="text-xs text-muted sm:col-span-4">
            現在の発行済み見積：{parent.quote_no} 第{parent.revision}版 {formatYen(parent.total)}（下書きを保存しても発行済み見積は変わりません）
          </p>
        )}
      </section>

      {/* 保存のたびに版が進むので、保存後は DB の内容（新しい行の line_key・経費の行など）で作り直す */}
      <StandardQuoteEditor
        key={draft.lock_version}
        draftId={draft.id}
        lockVersion={draft.lock_version}
        taxRate={String(draft.tax_rate)}
        savedUnresolvedNames={savedUnresolvedNames}
        initial={standardQuoteStateFromPayload(payload)}
      />
    </AdminPage>
  );
}
