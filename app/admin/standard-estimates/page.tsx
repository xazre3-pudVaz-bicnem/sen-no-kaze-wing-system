import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { createClient } from '@/lib/supabase/server';
import { createStandardEstimateDraftAction, setSimulatorStandardPricingAction } from '@/lib/actions/standard-estimates';
import { isMissingNamedFunction } from '@/lib/data/schema-compat';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '標準見積 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

type MasterRow = { id: string; base_master_id: string; base_model_id: string; spec_code: string; name: string; current_published_revision_id: string | null };
type RevisionRow = { id: string; standard_estimate_master_id: string; version: number; status: string; total: number; has_por: boolean; published_at: string | null };
type BaseMasterRow = { id: string; name: string; fire_spec_code: string; matrix_row_id: string | null; current_published_revision_id: string | null };

const ERROR_TEXT: Record<string, string> = {
  local: '標準見積の管理はSupabase接続環境で利用できます。',
  invalid: '入力内容を確認してください。',
  switch_confirm: '切り替える前に、確認の欄にチェックを入れてください。',
};

/**
 * シミュレーターの価格（サイトの新価格への切り替えスイッチ）。
 * 切り替えるまでは、標準状態の商品を登録して公開しても、お客様の画面・保存した仕様・見積依頼は現在の価格のまま。
 */
function SimulatorPricingPanel({
  state,
  models,
}: {
  state: 'off' | 'on' | 'unavailable';
  models: { slug: string; name: string }[];
}) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="simulator-pricing-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">シミュレーターの価格</h2>
        {state === 'on' ? (
          <Badge tone="success">新しい標準見積の価格</Badge>
        ) : state === 'off' ? (
          <Badge tone="neutral">現在のサイト価格（切り替え前）</Badge>
        ) : (
          <Badge tone="warn">切り替えの仕組みが未適用</Badge>
        )}
      </div>
      <p className="text-xs leading-5 text-muted">
        標準状態の商品を登録して公開しても、ここで切り替えるまでは、お客様のシミュレーター・保存した仕様の金額・見積依頼は現在の価格のままです。
        切り替えは、本番の画面で最終金額を確認し、先方の確認が済んでから行います。
      </p>
      {models.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {models.map((model) => (
            <Link
              key={model.slug}
              href={`/simulator/${model.slug}?preview=standard`}
              target="_blank"
              rel="noopener"
              className="btn-secondary btn-sm"
            >
              {model.name}を新しい価格でプレビュー
            </Link>
          ))}
        </div>
      )}
      {state === 'off' && (
        <form action={setSimulatorStandardPricingAction} className="flex flex-wrap items-center gap-3 rounded-lg bg-[#fbf7ef] p-3">
          <input type="hidden" name="enabled" value="true" />
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" name="confirmed" />
            先方の最終確認が済み、サイトの新価格へ切り替えます
          </label>
          <button type="submit" className="btn-secondary btn-sm">
            新しい標準見積の価格に切り替える
          </button>
        </form>
      )}
      {state === 'on' && (
        <form action={setSimulatorStandardPricingAction}>
          <input type="hidden" name="enabled" value="false" />
          <button type="submit" className="btn-secondary btn-sm">
            これまでの計算に戻す
          </button>
        </form>
      )}
    </section>
  );
}

/** 標準見積（本部）：機種・用途・サイズ・防火ごとの標準見積と、その公開版・下書き */
export default async function StandardEstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin('/admin/standard-estimates');
  const sp = await searchParams;
  const errorText = sp.error ? ERROR_TEXT[sp.error] ?? sp.error : null;

  if (isLocalMode()) {
    return (
      <AdminPage title="標準見積">
        <Alert tone="info">この画面はSupabase接続環境で利用できます。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const store = await getStore();
  const [matrix, models, masters, revisions, baseMasters, pricingSwitch] = await Promise.all([
    store.getSpecMatrix(),
    store.listModels({ includeDraft: true }),
    supabase.from('standard_estimate_masters').select('id, base_master_id, base_model_id, spec_code, name, current_published_revision_id').eq('status', 'active'),
    supabase.from('standard_estimate_revisions').select('id, standard_estimate_master_id, version, status, total, has_por, published_at').in('status', ['draft', 'published']),
    supabase.from('base_masters').select('id, name, fire_spec_code, matrix_row_id, current_published_revision_id').eq('status', 'active'),
    supabase.rpc('simulator_standard_pricing_enabled'),
  ]);
  const pricingState: 'off' | 'on' | 'unavailable' = pricingSwitch.error
    ? isMissingNamedFunction(pricingSwitch.error, 'simulator_standard_pricing_enabled')
      ? 'unavailable'
      : 'off'
    : pricingSwitch.data === true
      ? 'on'
      : 'off';
  const loadError = masters.error || revisions.error || baseMasters.error;
  if (loadError) {
    return (
      <AdminPage title="標準見積">
        <Alert tone="danger">{loadError.message}</Alert>
      </AdminPage>
    );
  }

  const masterRows = (masters.data ?? []) as MasterRow[];
  const revisionRows = (revisions.data ?? []) as RevisionRow[];
  const baseRows = (baseMasters.data ?? []) as BaseMasterRow[];
  const identity = (base: BaseMasterRow | undefined) => {
    const row = matrix?.rows.find((candidate) => candidate.id === base?.matrix_row_id);
    const model = models.find((candidate) => candidate.id === row?.base_model_id);
    const spec = matrix?.specs.find((candidate) => candidate.code === row?.spec_code);
    const size = matrix?.sizes.find((candidate) => candidate.code === row?.size_code);
    return row
      ? `${model?.name ?? '不明な機種'} / ${spec?.label ?? row.spec_code} / ${size?.label ?? row.size_code} / ${base?.fire_spec_code === 'fire' ? '防火' : '非防火'}`
      : base?.name ?? '不明な本体';
  };
  const withoutEstimate = baseRows.filter(
    (base) => base.current_published_revision_id && base.matrix_row_id && !masterRows.some((master) => master.base_master_id === base.id)
  );

  return (
    <AdminPage
      title="標準見積"
      lead="本体マスター（機種・用途・サイズ・防火）ごとの標準見積です。率（販売費率・経費率・掛率）と内外装・オプションの明細から、DB が金額を計算します。"
      actions={
        <Link href="/admin/matrix" className="text-sm underline-offset-4 hover:underline">
          本体仕様マトリクス
        </Link>
      }
    >
      {errorText && <Alert tone="danger">{errorText}</Alert>}
      {sp.switched === 'on' && <Alert tone="success">シミュレーターの価格を新しい標準見積に切り替えました。</Alert>}
      {sp.switched === 'off' && <Alert tone="success">シミュレーターの価格をこれまでの計算に戻しました。</Alert>}
      <SimulatorPricingPanel
        state={pricingState}
        models={models.filter((model) => model.status === 'published').map((model) => ({ slug: model.slug, name: model.name }))}
      />
      <Table minWidth="56rem">
        <thead>
          <tr>
            <Th>機種・用途・サイズ・防火</Th>
            <Th>公開版</Th>
            <Th right>税込合計（公開版）</Th>
            <Th>下書き</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody>
          {masterRows.map((master) => {
            const base = baseRows.find((candidate) => candidate.id === master.base_master_id);
            const published = revisionRows.find((revision) => revision.id === master.current_published_revision_id);
            const draft = revisionRows.find((revision) => revision.standard_estimate_master_id === master.id && revision.status === 'draft');
            return (
              <tr key={master.id} data-testid="standard-estimate-row">
                <Td>{identity(base)}</Td>
                <Td>
                  {published ? (
                    <span className="inline-flex items-center gap-2">
                      第{published.version}版
                      {published.has_por && <Badge tone="warn">価格未確定の行あり</Badge>}
                    </span>
                  ) : (
                    <span className="text-muted">未公開</span>
                  )}
                </Td>
                <Td right>{published ? formatYen(published.total) : '—'}</Td>
                <Td>{draft ? <Badge tone="warn">第{draft.version}版を編集中</Badge> : <span className="text-muted">—</span>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-3">
                    {draft && (
                      <Link href={`/admin/standard-estimates/${draft.id}`} className="underline-offset-4 hover:underline">
                        下書きを編集
                      </Link>
                    )}
                    {published && (
                      <Link href={`/admin/standard-estimates/${published.id}`} className="underline-offset-4 hover:underline">
                        公開版を見る
                      </Link>
                    )}
                    {published && (
                      <Link href={`/admin/quotes/standard-drafts/new?revision=${published.id}`} className="underline-offset-4 hover:underline">
                        見積書を作成
                      </Link>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {masterRows.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-muted">標準見積はまだありません。</Td>
            </tr>
          )}
        </tbody>
      </Table>

      {withoutEstimate.length > 0 && (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="font-semibold">標準見積の無い本体</h2>
          <p className="text-xs text-muted">公開中の本体 Revision を基準に、標準見積の下書きを作れます（率は初期値の販売費率 100%・経費率 15%・掛率 150%）。</p>
          <ul className="space-y-2">
            {withoutEstimate.map((base) => (
              <li key={base.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{identity(base)}</span>
                <form action={createStandardEstimateDraftAction}>
                  <input type="hidden" name="base_master_revision_id" value={base.current_published_revision_id ?? ''} />
                  <button type="submit" className="btn-secondary btn-sm">標準見積の下書きを作成</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminPage>
  );
}
