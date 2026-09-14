import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import {
  createLegacyBaseMigrationBatchAction,
  finalizeLegacyBaseMigrationReviewAction,
  resolveLegacyEstimateDuplicateAction,
  setLegacyBaseMappingDecisionAction,
  setLegacyBaseSpecMappingAction,
} from '@/lib/actions/base-migration';

type Row = Record<string, unknown>;
type Search = Promise<Record<string, string | undefined>>;

function statusLabel(status: string) {
  return {
    draft: '作成中',
    reviewing: 'レビュー中',
    ready: '移行準備完了',
    migrated: '移行済み',
    validated: '検算済み',
    completed: '完了',
    cancelled: '取消',
  }[status] ?? status;
}

function targetLabel(target: string) {
  return {
    base: '本体',
    interior_exterior: '内外装工事',
    option: 'オプション',
    review: '要確認',
  }[target] ?? target;
}

export default async function BaseMigrationPage({ searchParams }: { searchParams: Search }) {
  await requireCatalogEditor('/admin/base-migration');
  const sp = await searchParams;

  if (isLocalMode()) {
    return (
      <AdminPage title="旧本体内訳の移行監査">
        <Alert tone="info">この画面はSupabase接続環境で利用できます。旧データ自体は変更しません。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const [{ data: canView, error: viewError }, { data: canManage, error: manageError }] = await Promise.all([
    supabase.rpc('can_view_legacy_base_migration'),
    supabase.rpc('can_manage_legacy_base_migration'),
  ]);

  if (viewError || manageError) {
    return <AdminPage title="旧本体内訳の移行監査"><Alert tone="danger">{(viewError ?? manageError)?.message}</Alert></AdminPage>;
  }
  if (!canView) {
    return <AdminPage title="旧本体内訳の移行監査"><Alert tone="warn">本部だけが参照できます。</Alert></AdminPage>;
  }

  const { data: batchData, error: batchError } = await supabase
    .from('legacy_base_migration_batches')
    .select('*')
    .order('created_at', { ascending: false });
  if (batchError) {
    return <AdminPage title="旧本体内訳の移行監査"><Alert tone="danger">{batchError.message}</Alert></AdminPage>;
  }

  const batches = (batchData ?? []) as Row[];
  const selected = batches.find((row) => row.id === sp.batch) ?? batches.find((row) => row.status === 'reviewing') ?? batches[0] ?? null;

  const models = await (await getStore()).listModels({ includeDraft: true });
  const modelMap = new Map(models.map((model) => [model.id, model.name]));

  let mappings: Row[] = [];
  let specs: Row[] = [];
  let duplicates: Row[] = [];
  let snapshots: Row[] = [];

  if (selected) {
    const batchId = String(selected.id);
    const [m, s, d, f] = await Promise.all([
      supabase.from('legacy_base_breakdown_mappings').select('*').eq('migration_batch_id', batchId).order('legacy_sort_order'),
      supabase.from('legacy_base_spec_mappings').select('*').eq('migration_batch_id', batchId).order('legacy_spec_code'),
      supabase.from('legacy_estimate_duplicate_checks').select('*').eq('migration_batch_id', batchId).order('match_type'),
      supabase.from('legacy_migration_financial_snapshots').select('*').eq('migration_batch_id', batchId).order('legacy_spec_code'),
    ]);
    const error = m.error || s.error || d.error || f.error;
    if (error) return <AdminPage title="旧本体内訳の移行監査"><Alert tone="danger">{error.message}</Alert></AdminPage>;
    mappings = (m.data ?? []) as Row[];
    specs = (s.data ?? []) as Row[];
    duplicates = (d.data ?? []) as Row[];
    snapshots = (f.data ?? []) as Row[];
  }

  const pendingMappings = mappings.filter((row) => row.review_status !== 'approved' || row.target_classification === 'review');
  const pendingSpecs = specs.filter((row) => row.decision_status !== 'approved' || !row.proposed_group_key);
  const pendingDuplicates = duplicates.filter((row) => row.resolution === 'pending');
  const automatic = mappings.filter((row) => row.decision_type === 'automatic' && row.review_status === 'approved');
  const editable = Boolean(canManage) && selected?.status === 'reviewing';
  const filter = sp.filter === 'all' ? 'all' : 'pending';
  const visibleMappings = filter === 'all' ? mappings : pendingMappings;
  const ready = Boolean(selected) && pendingMappings.length === 0 && pendingSpecs.length === 0 && pendingDuplicates.length === 0 && snapshots.length > 0;

  return (
    <AdminPage
      title="旧本体内訳の移行監査"
      lead="旧本体内訳を新本体・内外装工事へ移す前に、元データを固定し、分類・重複・金額を確認します。ここでは実移行しません。"
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.created && <Alert tone="success">監査バッチを作成しました。旧データは変更していません。</Alert>}
      {sp.saved && <Alert tone="success">判定を保存しました。</Alert>}
      {sp.ready && <Alert tone="success">レビュー完了です。実移行は次のPRで行います。</Alert>}

      <Alert tone="info">
        このPRでは base_breakdown_items / estimate_templates / 本体マスター / シミュレーターへ書き込みません。
      </Alert>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">監査バッチ</h2>
        <div className="flex flex-wrap gap-2">
          {batches.map((batch) => (
            <Link key={String(batch.id)} href={`/admin/base-migration?batch=${batch.id}`} className={batch.id === selected?.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
              {statusLabel(String(batch.status))}
            </Link>
          ))}
        </div>
        {canManage && (
          <form action={createLegacyBaseMigrationBatchAction} className="flex flex-wrap gap-2">
            <Input name="description" className="min-w-72 flex-1" placeholder="監査メモ（任意）" />
            <Button type="submit">現在の旧データを固定して監査開始</Button>
          </form>
        )}
      </section>

      {selected && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['状態', statusLabel(String(selected.status))],
              ['自動確定', String(automatic.length)],
              ['要確認', String(pendingMappings.length)],
              ['旧仕様対応 未確認', String(pendingSpecs.length)],
              ['重複候補 未解決', String(pendingDuplicates.length)],
            ].map(([label, value]) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">旧本体明細の分類</h2>
                <p className="text-sm text-muted">名称だけで判断できない行は「要確認」に残します。</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/admin/base-migration?batch=${selected.id}`} className={filter === 'pending' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>要確認のみ</Link>
                <Link href={`/admin/base-migration?batch=${selected.id}&filter=all`} className={filter === 'all' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>すべて</Link>
              </div>
            </div>

            {visibleMappings.map((row) => (
              <form key={String(row.id)} action={setLegacyBaseMappingDecisionAction} className="card grid gap-3 p-4 lg:grid-cols-[10rem_10rem_1fr_8rem_12rem_1fr_auto] lg:items-center">
                <input type="hidden" name="batch_id" value={String(selected.id)} />
                <input type="hidden" name="mapping_id" value={String(row.id)} />
                <div><p className="text-xs text-muted">モデル／旧仕様</p><p className="font-semibold">{modelMap.get(String(row.base_model_id)) ?? '—'}／{String(row.legacy_spec_code)}</p></div>
                <div><p className="text-xs text-muted">旧工事区分</p><p>{String(row.legacy_section)}</p></div>
                <div>
                  <p className="font-semibold">{String(row.legacy_name)}</p>
                  <p className="text-xs text-muted">{String(row.legacy_quantity)} {row.legacy_unit ? String(row.legacy_unit) : ''} ／ {row.legacy_remark ? String(row.legacy_remark) : '備考なし'}</p>
                </div>
                <div className="text-right font-semibold">{formatYen(Number(row.legacy_amount))}</div>
                <Select name="target_classification" defaultValue={String(row.target_classification)}>
                  <option value="base">本体</option>
                  <option value="interior_exterior">内外装工事</option>
                  <option value="option">オプション</option>
                  <option value="review">要確認</option>
                </Select>
                <Input name="note" defaultValue={row.decision_type === 'human' && row.decision_reason ? String(row.decision_reason) : ''} placeholder="判断理由" disabled={!editable} />
                {editable ? <Button type="submit" variant="secondary">保存</Button> : <Badge tone={row.review_status === 'approved' ? 'success' : 'warn'}>{targetLabel(String(row.target_classification))}</Badge>}
              </form>
            ))}
            {visibleMappings.length === 0 && <Alert tone="success">要確認の明細はありません。</Alert>}
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">旧仕様 → 新本体グループ</h2><p className="text-sm text-muted">hotel / residence / office を用途名のまま分けず、本体明細の実差で決めます。</p></div>
            <Table minWidth="56rem">
              <thead className="bg-sand/60"><tr><Th>モデル</Th><Th>旧仕様</Th><Th>グループキー</Th><Th>理由</Th><Th>状態</Th><Th></Th></tr></thead>
              <tbody className="divide-y divide-line">
                {specs.map((row) => (
                  <tr key={String(row.id)}>
                    <Td>{modelMap.get(String(row.base_model_id)) ?? '—'}</Td>
                    <Td className="font-semibold">{String(row.legacy_spec_code)}</Td>
                    <Td>{row.proposed_group_key ? String(row.proposed_group_key) : '—'}</Td>
                    <Td className="text-xs text-muted">{row.reason ? String(row.reason) : '—'}</Td>
                    <Td>{row.decision_status === 'approved' ? <Badge tone="success">確認済み</Badge> : <Badge tone="warn">要確認</Badge>}</Td>
                    <Td>
                      {editable && (
                        <form action={setLegacyBaseSpecMappingAction} className="flex min-w-[28rem] gap-2">
                          <input type="hidden" name="batch_id" value={String(selected.id)} />
                          <input type="hidden" name="base_model_id" value={String(row.base_model_id)} />
                          <input type="hidden" name="legacy_spec_code" value={String(row.legacy_spec_code)} />
                          <Input name="proposed_group_key" defaultValue={row.proposed_group_key ? String(row.proposed_group_key) : ''} placeholder="例：wing-standard" required />
                          <Input name="reason" defaultValue={row.reason ? String(row.reason) : ''} placeholder="理由" />
                          <Button type="submit" variant="secondary">確認</Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">二重計上候補</h2><p className="text-sm text-muted">移動先の既存標準見積に同等行がないか確認します。</p></div>
            {duplicates.length === 0 ? <Alert tone="success">現在の分類では重複候補はありません。</Alert> : (
              <Table minWidth="52rem">
                <thead className="bg-sand/60"><tr><Th>一致</Th><Th>既存標準見積行</Th><Th right>金額</Th><Th>解決</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {duplicates.map((row) => (
                    <tr key={String(row.id)}>
                      <Td>{row.match_type === 'exact' ? <Badge tone="warn">完全一致</Badge> : '候補'}</Td>
                      <Td className="font-semibold">{String(row.candidate_name)}</Td>
                      <Td right>{formatYen(Number(row.candidate_amount))}</Td>
                      <Td>
                        {editable ? (
                          <form action={resolveLegacyEstimateDuplicateAction} className="flex gap-2">
                            <input type="hidden" name="batch_id" value={String(selected.id)} />
                            <input type="hidden" name="check_id" value={String(row.id)} />
                            <Select name="resolution" defaultValue={row.resolution === 'pending' ? 'not_duplicate' : String(row.resolution)}>
                              <option value="not_duplicate">重複ではない</option>
                              <option value="use_legacy">旧本体行を採用</option>
                              <option value="use_existing">既存行を採用</option>
                              <option value="keep_both">両方必要</option>
                            </Select>
                            <Button type="submit" variant="secondary">保存</Button>
                          </form>
                        ) : String(row.resolution)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">移行前の金額基準</h2><p className="text-sm text-muted">後続PRで新構造と1円単位で比較する基準です。</p></div>
            <Table minWidth="62rem">
              <thead className="bg-sand/60"><tr><Th>モデル</Th><Th>旧仕様</Th><Th right>旧本体</Th><Th right>調整前</Th><Th right>調整</Th><Th right>税</Th><Th right>税込合計</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {snapshots.map((row) => (
                  <tr key={String(row.id)}>
                    <Td>{modelMap.get(String(row.base_model_id)) ?? '—'}</Td>
                    <Td className="font-semibold">{String(row.legacy_spec_code)}</Td>
                    <Td right>{formatYen(Number(row.legacy_base_total ?? row.legacy_base_line_total ?? 0))}</Td>
                    <Td right>{row.subtotal_raw == null ? '—' : formatYen(Number(row.subtotal_raw))}</Td>
                    <Td right>{row.adjustment == null ? '—' : formatYen(Number(row.adjustment))}</Td>
                    <Td right>{row.tax == null ? '—' : formatYen(Number(row.tax))}</Td>
                    <Td right>{row.total == null ? '—' : formatYen(Number(row.total))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>

          {canManage && selected.status === 'reviewing' && (
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">レビュー完了</h2>
              <p className="text-sm">明細未確認 {pendingMappings.length}件 ／ 仕様未確認 {pendingSpecs.length}件 ／ 重複未解決 {pendingDuplicates.length}件</p>
              <form action={finalizeLegacyBaseMigrationReviewAction}>
                <input type="hidden" name="batch_id" value={String(selected.id)} />
                <Button type="submit" disabled={!ready}>レビューを確定して「移行準備完了」にする</Button>
              </form>
              {!ready && <p className="text-xs text-muted">すべての確認を終えるまで確定できません。</p>}
            </section>
          )}
        </>
      )}

      {!selected && <Alert tone="info">監査バッチはまだありません。</Alert>}
    </AdminPage>
  );
}
