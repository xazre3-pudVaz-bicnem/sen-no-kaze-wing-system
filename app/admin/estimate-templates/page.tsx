import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { listStandardEstimateWorkspaceEntries, loadStandardEstimateWorkspace, type StandardEstimateWorkspaceEntry } from '@/lib/data/standard-estimate-workspace';
import { startStandardEstimateV25DraftAction } from '@/lib/actions/standard-estimate-v25';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';
import { StandardEstimateV25Workbench } from '@/components/admin/standard-estimate-v25-workbench';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';

export const dynamic = 'force-dynamic';

const PRICING_LABEL = { 'v2.5': 'v2.5', legacy: 'v2.5 以前' } as const;

/**
 * 見積書管理 ＞ 標準見積（Excel 風の画面）。v2.5 の標準見積の正式な編集画面（2026-10-27 先方方針）。
 * 本部が編集・保存・公開する（総代理店の確認の工程は持たない）。保存・計算・Revision・公開は DB の RPC（20261019100000）。
 * 旧テンプレート（estimate_templates）は「旧テンプレート（参照）」に残す（正式な見積・Revision・Snapshot・履歴・参照は変えない）。
 */
export default async function EstimateTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin('/admin/estimate-templates');
  const sp = await searchParams;
  const headerActions = (
    <div className="flex flex-wrap gap-2">
      <Link href="/admin/standard-estimates" className="btn-primary btn-sm">＋ 新しい標準見積を作る</Link>
      <Link href="/admin/standard-estimates" className="btn-secondary btn-sm">価格の切り替え</Link>
      <Link href="/admin/estimate-templates/legacy" className="btn-secondary btn-sm">旧テンプレート（参照）</Link>
    </div>
  );

  if (isLocalMode()) {
    return (
      <AdminPage title="見積書管理" actions={headerActions}>
        <QuoteManagementTabs active="standard" />
        <Alert tone="info">標準見積（v2.5）の編集はSupabase接続環境で利用できます。旧テンプレートは「旧テンプレート（参照）」で確認できます。</Alert>
      </AdminPage>
    );
  }

  const [supabase, store] = await Promise.all([createClient(), getStore()]);
  const entries = await listStandardEstimateWorkspaceEntries(supabase, store);
  if (!entries) {
    return (
      <AdminPage title="見積書管理" actions={headerActions}>
        <QuoteManagementTabs active="standard" />
        <Alert tone="warn">標準見積の仕組みがまだ使えません（DB の反映待ち）。</Alert>
      </AdminPage>
    );
  }
  const selected = entries.find((entry) => entry.masterId === sp.master) ?? entries[0] ?? null;
  const workspace = selected ? await loadStandardEstimateWorkspace(supabase, selected) : null;

  return (
    <AdminPage title="見積書管理" lead="標準見積を Excel の表と同じ並びで編集し、本部が公開します。" actions={headerActions}>
      <QuoteManagementTabs active="standard" />
      {sp.started && <Alert tone="success">v2.5 の下書きを作りました。内容を確認して保存・公開してください。</Alert>}
      {sp.error && <Alert tone="danger">{sp.error === 'local' ? '標準見積の管理はSupabase接続環境で利用できます。' : sp.error === 'invalid' ? '入力内容を確認してください。' : sp.error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="標準見積の一覧" className="space-y-1 rounded-lg border border-line bg-white p-2 lg:max-h-[78vh] lg:overflow-y-auto" data-testid="standard-estimate-selector">
          {entries.length === 0 && <p className="px-2 py-4 text-sm text-muted">標準見積がまだありません。「新しい標準見積を作る」で、本体マスターの公開版から作成してください。</p>}
          {entries.map((entry) => (
            <EntryLink key={entry.masterId} entry={entry} active={entry.masterId === selected?.masterId} />
          ))}
        </nav>

        <div className="min-w-0 space-y-3">
          {selected && workspace ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{selected.identity}</h2>
                <Badge tone={workspace.revision.status === 'draft' ? 'warn' : 'success'}>
                  第{workspace.revision.version}版・{workspace.revision.status === 'draft' ? '下書き' : '公開中'}
                </Badge>
                <Badge tone="neutral">{PRICING_LABEL[workspace.revision.pricingModel]}</Badge>
                <Link href={`/admin/standard-estimates/${workspace.revision.id}`} className="text-xs text-navy underline">版の詳細</Link>
              </div>

              {workspace.v25 ? (
                <>
                  {workspace.revision.status === 'published' && (
                    <StartDraftForm entry={selected} label="次の版の下書きを作る" title="次の版の下書きを作りますか？" message="公開中の版を土台に、v2.5 の下書きを作ります。公開中の版は変わりません。" />
                  )}
                  <StandardEstimateV25Workbench
                    resetKey={`${workspace.revision.id}:${workspace.revision.lockVersion}`}
                    revisionId={workspace.revision.id}
                    lockVersion={workspace.revision.lockVersion}
                    readOnly={workspace.revision.status !== 'draft'}
                    baseLines={workspace.v25.baseLines}
                    candidates={workspace.v25.candidates}
                    initial={workspace.v25.initial}
                    costs={workspace.v25.costs}
                    rule={workspace.v25.rule}
                    taxRule={workspace.v25.taxRule}
                    preview={workspace.v25.preview}
                    savedTotal={workspace.revision.hasPor ? null : workspace.revision.total}
                  />
                </>
              ) : (
                <section className="space-y-3 rounded-lg border border-line bg-white p-4 text-sm" data-testid="standard-estimate-legacy-notice">
                  <p>
                    この標準見積は v2.5 以前の方式です（第{workspace.revision.version}版・{workspace.revision.status === 'draft' ? '下書き' : '公開中'}・
                    税込 {workspace.revision.hasPor ? `${formatYen(workspace.revision.total)}＋別途見積` : formatYen(workspace.revision.total)}）。
                  </p>
                  <p className="text-xs leading-5 text-muted">
                    v2.5 の下書きに切り替えると、商品台帳の商品・原価 Version から計算します。v2.5 以前の明細は「要見直し」として写り、見直すまで公開できません。
                    公開中の版・発行済みの見積は変わりません。
                  </p>
                  <StartDraftForm
                    entry={selected}
                    label="v2.5 の下書きにする"
                    title="v2.5 の下書きにしますか？"
                    message="この標準見積を v2.5 の下書きで編集します。v2.5 以前の下書きがあれば、その下書きを v2.5 に切り替えます（公開中の版は変わりません）。"
                  />
                </section>
              )}
            </>
          ) : selected ? (
            <Alert tone="warn">この標準見積には公開中の版・下書きがありません。</Alert>
          ) : null}
        </div>
      </div>
    </AdminPage>
  );
}

function EntryLink({ entry, active }: { entry: StandardEstimateWorkspaceEntry; active: boolean }) {
  return (
    <Link
      href={`/admin/estimate-templates?master=${entry.masterId}`}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-md px-2 py-1.5 text-xs leading-5 ${active ? 'bg-ink text-white' : 'text-ink hover:bg-sand'}`}
    >
      <span className="block font-semibold">{entry.identity}</span>
      <span className={active ? 'text-white/80' : 'text-muted'}>
        {entry.published ? `公開中 第${entry.published.version}版（${PRICING_LABEL[entry.published.pricingModel]}）` : '未公開'}
        {entry.draft ? `・下書きあり（${PRICING_LABEL[entry.draft.pricingModel]}）` : ''}
      </span>
    </Link>
  );
}

function StartDraftForm({ entry, label, title, message }: { entry: StandardEstimateWorkspaceEntry; label: string; title: string; message: string }) {
  return (
    <form action={startStandardEstimateV25DraftAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="master_id" value={entry.masterId} />
      {entry.draft && <input type="hidden" name="expected_draft_lock_version" value={entry.draft.lockVersion} />}
      <input type="hidden" name="return_to" value="workbench" />
      <ConfirmSubmit className="btn-secondary btn-sm" dialogTitle={title} message={message} confirmLabel={label}>
        {label}
      </ConfirmSubmit>
    </form>
  );
}
