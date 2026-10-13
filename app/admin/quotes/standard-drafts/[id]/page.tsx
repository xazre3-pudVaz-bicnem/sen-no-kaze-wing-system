import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { standardQuoteStateFromPayload, type StandardQuoteDraftPayload } from '@/lib/domain/standard-quote-view';
import { createClient } from '@/lib/supabase/server';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { StandardQuoteEditor } from '@/components/admin/standard-quote-editor';

export const metadata: Metadata = { title: '標準見積から作成した見積下書き | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

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
  const savedHasPor = payload.items.some((item) => item.price_mode === 'por');
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
          <p className="text-xs text-muted">価格未確定の行</p>
          <p>{savedHasPor ? <Badge tone="warn">あり（発行できません）</Badge> : 'なし'}</p>
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
        savedHasPor={savedHasPor}
        initial={standardQuoteStateFromPayload(payload)}
      />
    </AdminPage>
  );
}
