import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { formatYen } from '@/lib/domain/pricing';
import { assessLegacyBaseMigrationReadiness } from '@/lib/domain/legacy-base-migration';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import {
  createLegacyBaseMigrationBatchAction,
  finalizeLegacyBaseMigrationReviewAction,
  materializeLegacyBaseDraftsAction,
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
    sitework: '別途',
    review: '要確認',
  }[target] ?? target;
}

export default async function BaseMigrationPage({ searchParams }: { searchParams: Search }) {
  await requireUser('/admin/base-migration');
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
  let draftOutputs: Row[] = [];
  let lineLinks: Row[] = [];

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

  if (selected && ['migrated', 'validated', 'completed'].includes(String(selected.status))) {
    const batchId = String(selected.id);
    const [o, l] = await Promise.all([
      supabase
        .from('legacy_base_migration_draft_outputs')
        .select('*')
        .eq('migration_batch_id', batchId)
        .order('proposed_group_key'),
      supabase
        .from('legacy_base_migration_line_links')
        .select('id,draft_output_id,mapping_id,revision_line_id,revision_line_key')
        .eq('migration_batch_id', batchId),
    ]);
    const outputError = o.error || l.error;
    if (outputError) return <AdminPage title="旧本体内訳の移行監査"><Alert tone="danger">{outputError.message}</Alert></AdminPage>;
    draftOutputs = (o.data ?? []) as Row[];
    lineLinks = (l.data ?? []) as Row[];
  }

  const pendingMappings = mappings.filter((row) => row.review_status !== 'approved' || row.target_classification === 'review');
  const pendingSpecs = specs.filter((row) => row.decision_status !== 'approved' || !row.proposed_group_key);
  const pendingDuplicates = duplicates.filter((row) => row.resolution === 'pending');
  const automatic = mappings.filter((row) => row.decision_type === 'automatic' && row.review_status === 'approved');
  const editable = Boolean(canManage) && selected?.status === 'reviewing';
  const filter = sp.filter === 'all' ? 'all' : 'pending';
  const visibleMappings = filter === 'all' ? mappings : pendingMappings;
  const mappingMap = new Map(mappings.map((row) => [String(row.id), row]));
  const snapshotMap = new Map(
    snapshots.map((row) => [`${String(row.base_model_id)}::${String(row.legacy_spec_code)}`, row])
  );
  const lineCountByOutput = new Map<string, number>();
  for (const row of lineLinks) {
    const key = String(row.draft_output_id);
    lineCountByOutput.set(key, (lineCountByOutput.get(key) ?? 0) + 1);
  }
  const readiness = assessLegacyBaseMigrationReadiness({ mappings, specs, duplicates, snapshots });
  const ready = Boolean(selected) && readiness.canAttemptFinalize;

  return (
    <AdminPage
      title="旧本体内訳の移行監査"
      lead="旧本体内訳の元データを固定し、分類・重複・金額を監査します。ready確定後は監査済みの本体行だけを新本体Draftへ作成します。"
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.created && <Alert tone="success">監査バッチを作成しました。旧データは変更していません。</Alert>}
      {sp.saved && <Alert tone="success">判定を保存しました。</Alert>}
      {sp.ready && <Alert tone="success">レビュー完了です。readyバッチから新本体Draftを作成できます。</Alert>}
      {sp.drafted && <Alert tone="success">新本体Draftを作成しました。Publish・Simulator・Quoteはまだ切り替えていません。</Alert>}

      <Alert tone="info">
        旧 base_breakdown_items / estimate_templates は変更しません。ready後は監査済みの本体行だけを新本体Draftへコピーします。
      </Alert>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">監査バッチ</h2>
        <div className="flex flex-wrap gap-2">
          {batches.map((batch) => (
            <Link key={String(batch.id)} href={`/admin/base-migration?batch=${batch.id}`} className={batch.id === selected?.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
              {batch.created_at ? new Date(String(batch.created_at)).toLocaleDateString('ja-JP') : '—'}・{statusLabel(String(batch.status))}
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
          <section className="card grid gap-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">監査メモ</p>
              <p className="mt-1">{selected.source_description ? String(selected.source_description) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">元データSHA-256</p>
              <p className="mt-1 break-all font-mono text-xs">{selected.source_snapshot_hash ? String(selected.source_snapshot_hash) : '—'}</p>
            </div>
          </section>

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
                <input type="hidden" name="expected_version" value={String(row.decision_version ?? 0)} />
                <input type="hidden" name="target_group_label" value={row.target_group_label ? String(row.target_group_label) : ''} />
                <div><p className="text-xs text-muted">モデル／旧仕様</p><p className="font-semibold">{modelMap.get(String(row.base_model_id)) ?? '—'}／{String(row.legacy_spec_code)}</p></div>
                <div><p className="text-xs text-muted">旧工事区分</p><p>{String(row.legacy_section)}</p></div>
                <div>
                  <p className="font-semibold">{String(row.legacy_name)}</p>
                  <p className="text-xs text-muted">{String(row.legacy_quantity)} {row.legacy_unit ? String(row.legacy_unit) : ''} ／ {row.legacy_remark ? String(row.legacy_remark) : '備考なし'}</p>
                </div>
                <div className="text-right font-semibold">{formatYen(Number(row.legacy_amount))}</div>
                <Select name="target_classification" defaultValue={String(row.target_classification)} disabled={!editable}>
                  <option value="base">本体</option>
                  <option value="interior_exterior">内外装工事</option>
                  <option value="option">オプション</option>
                  <option value="sitework">別途</option>
                  <option value="review">要確認</option>
                </Select>
                <Input name="note" defaultValue={row.decision_type === 'human' && row.decision_reason ? String(row.decision_reason) : ''} placeholder="判断理由" disabled={!editable} />
                {editable ? <Button type="submit" variant="secondary">保存</Button> : <Badge tone={row.review_status === 'approved' ? 'success' : 'warn'}>{targetLabel(String(row.target_classification))}</Badge>}
              </form>
            ))}
            {visibleMappings.length === 0 && <Alert tone="success">要確認の明細はありません。</Alert>}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-semibold">旧仕様 → 新本体グループ</h2>
              <p className="text-sm text-muted">hotel / residence / office を用途名のまま分けず、本体明細の実差で決めます。</p>
              <p className="mt-1 text-xs text-muted">同じグループキーにまとめるには、本体に残す明細の工事区分・品名・数量・単位・単価・金額・備考と本体諸費用条件が一致している必要があります。</p>
            </div>
            <Table minWidth="56rem">
              <thead className="bg-sand/60"><tr><Th>モデル</Th><Th>旧仕様</Th><Th>取込元</Th><Th>グループキー</Th><Th>理由</Th><Th>状態</Th><Th></Th></tr></thead>
              <tbody className="divide-y divide-line">
                {specs.map((row) => {
                  const snapshot = snapshotMap.get(`${String(row.base_model_id)}::${String(row.legacy_spec_code)}`);
                  return (
                  <tr key={String(row.id)}>
                    <Td>{modelMap.get(String(row.base_model_id)) ?? '—'}</Td>
                    <Td className="font-semibold">{String(row.legacy_spec_code)}</Td>
                    <Td className="text-xs text-muted">
                      <p>{snapshot?.source_sheet_name ? String(snapshot.source_sheet_name) : '標準見積なし'}</p>
                      <p>基準商品 {Array.isArray(snapshot?.legacy_baseline_option_ids) ? snapshot.legacy_baseline_option_ids.length : 0}件</p>
                    </Td>
                    <Td>{row.proposed_group_key ? String(row.proposed_group_key) : '—'}</Td>
                    <Td className="text-xs text-muted">{row.reason ? String(row.reason) : '—'}</Td>
                    <Td>{row.decision_status === 'approved' ? <Badge tone="success">確認済み</Badge> : <Badge tone="warn">要確認</Badge>}</Td>
                    <Td>
                      {editable && (
                        <form action={setLegacyBaseSpecMappingAction} className="flex min-w-[28rem] gap-2">
                          <input type="hidden" name="batch_id" value={String(selected.id)} />
                          <input type="hidden" name="base_model_id" value={String(row.base_model_id)} />
                          <input type="hidden" name="legacy_spec_code" value={String(row.legacy_spec_code)} />
                          <input type="hidden" name="expected_version" value={String(row.decision_version ?? 0)} />
                          <Input name="proposed_group_key" defaultValue={row.proposed_group_key ? String(row.proposed_group_key) : ''} placeholder="例：wing-standard" required />
                          <Input name="reason" defaultValue={row.reason ? String(row.reason) : ''} placeholder="理由" />
                          <Button type="submit" variant="secondary">確認</Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </Table>
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">二重計上候補</h2><p className="text-sm text-muted">移動先の既存標準見積に同等行がないか確認します。</p></div>
            {duplicates.length === 0 ? <Alert tone="success">現在の分類では重複候補はありません。</Alert> : (
              <Table minWidth="52rem">
                <thead className="bg-sand/60"><tr><Th>一致</Th><Th>旧本体行</Th><Th right>旧金額</Th><Th>既存標準見積行</Th><Th right>既存金額</Th><Th>解決</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {duplicates.map((row) => {
                    const source = mappingMap.get(String(row.mapping_id));
                    return (
                    <tr key={String(row.id)}>
                      <Td>{row.match_type === 'exact' ? <Badge tone="warn">完全一致</Badge> : '候補'}</Td>
                      <Td>
                        <p className="font-semibold">{source ? String(source.legacy_name) : '—'}</p>
                        {source && (
                          <p className="mt-1 text-xs text-muted">
                            {String(source.legacy_section)} ／ 数量 {String(source.legacy_quantity)} {source.legacy_unit ? String(source.legacy_unit) : ''} ／ 単価 {formatYen(Number(source.legacy_unit_price))} ／ {source.legacy_remark ? String(source.legacy_remark) : '備考なし'}
                          </p>
                        )}
                      </Td>
                      <Td right>{source ? formatYen(Number(source.legacy_amount)) : '—'}</Td>
                      <Td>
                        <p className="font-semibold">{String(row.candidate_name)}</p>
                        <p className="mt-1 text-xs text-muted">
                          {String(row.candidate_section_code)}{row.candidate_group_label ? `／${String(row.candidate_group_label)}` : ''} ／ 数量 {row.candidate_quantity == null ? '—' : String(row.candidate_quantity)} {row.candidate_unit ? String(row.candidate_unit) : ''} ／ 単価 {row.candidate_unit_price == null ? '—' : formatYen(Number(row.candidate_unit_price))} ／ {row.candidate_remark ? String(row.candidate_remark) : '備考なし'}
                        </p>
                      </Td>
                      <Td right>{formatYen(Number(row.candidate_amount))}</Td>
                      <Td>
                        {editable ? (
                          <form action={resolveLegacyEstimateDuplicateAction} className="flex gap-2">
                            <input type="hidden" name="batch_id" value={String(selected.id)} />
                            <input type="hidden" name="check_id" value={String(row.id)} />
                            <input type="hidden" name="expected_version" value={String(row.decision_version ?? 0)} />
                            <Select name="resolution" defaultValue={row.resolution === 'pending' ? '' : String(row.resolution)} required>
                              <option value="" disabled>解決方法を選択</option>
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
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>

          <section className="space-y-3">
            <div><h2 className="font-semibold">移行前の金額基準</h2><p className="text-sm text-muted">後続PRで新構造と1円単位で比較する基準です。</p></div>
            <Table minWidth="82rem">
              <thead className="bg-sand/60"><tr><Th>モデル</Th><Th>旧仕様</Th><Th>取込元</Th><Th>旧本体</Th><Th>旧内外装</Th><Th>旧オプション</Th><Th>旧別途</Th><Th right>調整前</Th><Th right>調整</Th><Th right>税</Th><Th right>税込合計</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {snapshots.map((row) => (
                  <tr key={String(row.id)}>
                    <Td>{modelMap.get(String(row.base_model_id)) ?? '—'}</Td>
                    <Td className="font-semibold">{String(row.legacy_spec_code)}</Td>
                    <Td className="text-xs text-muted">
                      <p>{row.source_sheet_name ? String(row.source_sheet_name) : '標準見積なし'}</p>
                      <p>基準商品 {Array.isArray(row.legacy_baseline_option_ids) ? row.legacy_baseline_option_ids.length : 0}件</p>
                    </Td>
                    <Td>
                      <p className="font-semibold">{formatYen(Number(row.legacy_base_total ?? row.legacy_base_line_total ?? 0))}</p>
                      <p className="text-xs text-muted">明細 {formatYen(Number(row.legacy_base_line_total ?? 0))} ／ 諸費用率 {row.legacy_base_expense_rate == null ? '—' : String(row.legacy_base_expense_rate)} ／ 諸費用 {row.legacy_base_expense == null ? '—' : formatYen(Number(row.legacy_base_expense))}</p>
                    </Td>
                    <Td>
                      <p className="font-semibold">{row.legacy_interior_total == null ? '—' : formatYen(Number(row.legacy_interior_total))}</p>
                      <p className="text-xs text-muted">明細 {row.legacy_interior_line_total == null ? '—' : formatYen(Number(row.legacy_interior_line_total))} ／ 諸費用率 {row.legacy_interior_expense_rate == null ? '—' : String(row.legacy_interior_expense_rate)} ／ 諸費用 {row.legacy_interior_expense == null ? '—' : formatYen(Number(row.legacy_interior_expense))}</p>
                    </Td>
                    <Td>
                      <p className="font-semibold">{row.legacy_option_total == null ? '—' : formatYen(Number(row.legacy_option_total))}</p>
                      <p className="text-xs text-muted">明細 {row.legacy_option_line_total == null ? '—' : formatYen(Number(row.legacy_option_line_total))} ／ 諸費用率 {row.legacy_option_expense_rate == null ? '—' : String(row.legacy_option_expense_rate)} ／ 諸費用 {row.legacy_option_expense == null ? '—' : formatYen(Number(row.legacy_option_expense))}</p>
                    </Td>
                    <Td>
                      <p className="font-semibold">{row.legacy_sitework_total == null ? '—' : formatYen(Number(row.legacy_sitework_total))}</p>
                      <p className="text-xs text-muted">明細 {row.legacy_sitework_line_total == null ? '—' : formatYen(Number(row.legacy_sitework_line_total))} ／ 諸費用率 {row.legacy_sitework_expense_rate == null ? '—' : String(row.legacy_sitework_expense_rate)} ／ 諸費用 {row.legacy_sitework_expense == null ? '—' : formatYen(Number(row.legacy_sitework_expense))}</p>
                    </Td>
                    <Td right>{row.subtotal_raw == null ? '—' : formatYen(Number(row.subtotal_raw))}</Td>
                    <Td right>{row.adjustment == null ? '—' : formatYen(Number(row.adjustment))}</Td>
                    <Td right>{row.tax == null ? '—' : formatYen(Number(row.tax))}</Td>
                    <Td right>{row.total == null ? '—' : formatYen(Number(row.total))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>

          {draftOutputs.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="font-semibold">新本体Draft検算</h2>
                <p className="text-sm text-muted">
                  「旧本体明細」は移行前の本体区分全体、「新本体明細」は監査で本体に残した行だけの合計です。内外装工事・オプション・別途へ移した分は差額として残ります。
                </p>
              </div>
              <Table minWidth="78rem">
                <thead className="bg-sand/60">
                  <tr>
                    <Th>モデル</Th><Th>新本体グループ</Th><Th>代表旧仕様</Th>
                    <Th right>旧本体明細</Th><Th right>新本体明細</Th><Th right>本体から除外</Th>
                    <Th right>旧諸費用</Th><Th right>新諸費用</Th><Th right>新Draft計</Th>
                    <Th>追跡</Th><Th>防火区分</Th><Th></Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {draftOutputs.map((row) => {
                    const legacyLineTotal = Number(row.legacy_base_section_line_total ?? 0);
                    const targetLineTotal = Number(row.target_line_subtotal ?? 0);
                    const movedOut = legacyLineTotal - targetLineTotal;
                    return (
                      <tr key={String(row.id)}>
                        <Td>{modelMap.get(String(row.base_model_id)) ?? '—'}</Td>
                        <Td className="font-semibold">{String(row.proposed_group_key)}</Td>
                        <Td>{String(row.representative_legacy_spec_code)}</Td>
                        <Td right>{formatYen(legacyLineTotal)}</Td>
                        <Td right>{formatYen(targetLineTotal)}</Td>
                        <Td right>{formatYen(movedOut)}</Td>
                        <Td right>{formatYen(Number(row.legacy_base_expense ?? 0))}</Td>
                        <Td right>{formatYen(Number(row.target_expense_amount ?? 0))}</Td>
                        <Td right className="font-semibold">{formatYen(Number(row.target_total ?? 0))}</Td>
                        <Td>{lineCountByOutput.get(String(row.id)) ?? 0}行</Td>
                        <Td>{row.fire_spec_review_required ? <Badge tone="warn">要確認</Badge> : <Badge tone="success">確認済み</Badge>}</Td>
                        <Td>
                          <Link className="text-sm underline" href={`/admin/base-masters/${String(row.base_master_id)}`}>Draftを開く</Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </section>
          )}

          {canManage && ['ready', 'migrated'].includes(String(selected.status)) && (
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">新本体Draft作成</h2>
              <p className="text-sm">
                approvedの「本体」行だけを proposed_group_key 単位で本部所有の新本体Draftへコピーします。
              </p>
              <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                <p>内外装工事・オプション・別途はこの工程ではコピーしません。</p>
                <p>Publish・Simulator・Quoteの参照先は変更しません。</p>
                <p>旧行から新lineへの追跡を保存し、1円単位で再検算します。</p>
                <p>防火区分はDraft段階ではnon_fireを仮置きし、Publish前に明示確認します。</p>
              </div>
              <form action={materializeLegacyBaseDraftsAction}>
                <input type="hidden" name="batch_id" value={String(selected.id)} />
                <Button type="submit">
                  {selected.status === 'ready' ? '監査済みデータから新本体Draftを作成' : 'Draft作成結果を再検証'}
                </Button>
              </form>
              <p className="text-xs text-muted">
                DB側でready状態・STALE・group互換性を再確認し、途中で失敗した場合は同一RPC transaction全体がrollbackされます。
              </p>
            </section>
          )}

          {canManage && selected.status === 'reviewing' && (
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">レビュー完了</h2>
              <p className="text-sm">明細未確認 {readiness.pendingMappings}件 ／ 仕様未確認 {readiness.pendingSpecs}件 ／ 重複未解決 {readiness.pendingDuplicates}件</p>
              <div className="grid gap-1 text-xs text-muted sm:grid-cols-2 lg:grid-cols-3">
                <p>本体行0件の仕様：{readiness.zeroBaseSpecs}</p>
                <p>BOM不一致グループ：{readiness.incompatibleBodyGroups}</p>
                <p>本体諸費用不一致：{readiness.incompatibleExpenseGroups}</p>
                <p>金額snapshot不足：{readiness.incompleteSnapshots}</p>
                <p>単価×数量の不一致：{readiness.amountMismatches}</p>
                <p>整数円で保存不可：{readiness.nonIntegerBaseTotals}</p>
              </div>
              <form action={finalizeLegacyBaseMigrationReviewAction}>
                <input type="hidden" name="batch_id" value={String(selected.id)} />
                <Button type="submit" disabled={!ready}>DB最終検証を実行して「移行準備完了」にする</Button>
              </form>
              {!ready
                ? <p className="text-xs text-muted">すべての確認を終えるまで最終検証できません。</p>
                : <p className="text-xs text-muted">実行時にDB側で元データSTALE、BOM・諸費用互換性、金額snapshot、単価×数量、旧見積内部整合を再検証します。</p>}
            </section>
          )}
        </>
      )}

      {!selected && <Alert tone="info">監査バッチはまだありません。</Alert>}
    </AdminPage>
  );
}
