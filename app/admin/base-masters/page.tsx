import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { formatYen } from '@/lib/domain/pricing';
import { formatBaseMasterRevision } from '@/lib/domain/base-master-ui';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { BaseMasterCreateForm } from '@/components/admin/base-master-form';
import { BaseMasterExcelDemo } from '@/components/admin/base-master-excel-demo';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';

const memberRank: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
const baseMasterSchemaTables = [
  'organization_memberships',
  'organizations',
  'base_masters',
  'base_master_revisions',
] as const;

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
};

function isBaseMasterSchemaPending(error: PostgrestLikeError | null) {
  if (!error) return false;
  const message = error.message ?? '';
  const mentionsKnownTable = baseMasterSchemaTables.some(
    (table) =>
      message.includes(`public.${table}`) ||
      message.includes(`'${table}'`) ||
      message.includes(`\"${table}\"`)
  );
  return mentionsKnownTable && (error.code === 'PGRST205' || /schema cache/i.test(message));
}

function BaseMasterPreparingAlert() {
  return (
    <Alert tone="info">
      本体マスターは現在準備中です。本番データベースへの必要な設定反映までは、下の画面確認用サンプルで完成イメージを確認できます。サンプルはDBへ保存されません。
    </Alert>
  );
}

export default async function BaseMastersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireCatalogEditor('/admin/base-masters');
  const sp = await searchParams;
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });
  const showQuoteManagementTabs = user.role === 'admin';

  if (isLocalMode()) {
    return (
      <AdminPage
        title="本体マスター"
        lead="本体の製造明細・基準原価・公開履歴を管理します。"
        actions={<Link href="/admin/base-masters/demo" className="btn-secondary btn-sm">サンプル単独表示</Link>}
      >
        {showQuoteManagementTabs && <QuoteManagementTabs active="base" />}
        <Alert tone="info">ローカルJSONモードでは本体マスターDBを参照・編集せず、画面確認用サンプルだけを表示します。</Alert>
        <BaseMasterExcelDemo />
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const [
    { data: memberships, error: membershipError },
    { data: organizations, error: organizationError },
    { data: masters, error: masterError },
  ] = await Promise.all([
    supabase
      .from('organization_memberships')
      .select('organization_id, member_role, status')
      .eq('profile_id', user.id)
      .eq('status', 'active'),
    supabase
      .from('organizations')
      .select('id, name, organization_type, status')
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('base_masters')
      .select('id, base_model_id, owner_organization_id, name, fire_spec_code, status, current_published_revision_id, updated_at')
      .order('updated_at', { ascending: false }),
  ]);

  const loadError = membershipError || organizationError || masterError;
  if (loadError) {
    const schemaPending = isBaseMasterSchemaPending(loadError);
    return (
      <AdminPage title="本体マスター" lead="本体の製造明細・基準原価・公開履歴を管理します。">
        {showQuoteManagementTabs && <QuoteManagementTabs active="base" />}
        {schemaPending ? <BaseMasterPreparingAlert /> : <Alert tone="danger">{loadError.message}</Alert>}
        {schemaPending && <BaseMasterExcelDemo />}
      </AdminPage>
    );
  }

  const masterRows = masters ?? [];
  const masterIds = masterRows.map((row) => row.id);
  const revisionResult = masterIds.length
    ? await supabase
        .from('base_master_revisions')
        .select('id, base_master_id, version, status, total, updated_at')
        .in('base_master_id', masterIds)
        .order('version', { ascending: false })
    : { data: [], error: null };

  if (revisionResult.error) {
    const schemaPending = isBaseMasterSchemaPending(revisionResult.error);
    return (
      <AdminPage title="本体マスター" lead="本体の製造明細・基準原価・公開履歴を管理します。">
        {showQuoteManagementTabs && <QuoteManagementTabs active="base" />}
        {schemaPending ? <BaseMasterPreparingAlert /> : <Alert tone="danger">{revisionResult.error.message}</Alert>}
        {schemaPending && <BaseMasterExcelDemo />}
      </AdminPage>
    );
  }

  const modelMap = new Map(models.map((model) => [model.id, model]));
  const orgMap = new Map((organizations ?? []).map((org) => [org.id, org]));
  const revisionRows = revisionResult.data ?? [];
  const revisionsByMaster = new Map<string, typeof revisionRows>();
  for (const revision of revisionRows) {
    const rows = revisionsByMaster.get(revision.base_master_id) ?? [];
    rows.push(revision);
    revisionsByMaster.set(revision.base_master_id, rows);
  }

  const editableOrgIds = new Set(
    (memberships ?? [])
      .filter((membership) => (memberRank[membership.member_role] ?? -1) >= 1)
      .map((membership) => membership.organization_id)
  );
  const editableOrganizations = (organizations ?? [])
    .filter((org) => editableOrgIds.has(org.id))
    .filter((org) => org.organization_type === 'headquarters' || org.organization_type === 'master_dealer')
    .map((org) => ({ id: org.id, name: org.name }));

  const query = (sp.q ?? '').trim().toLocaleLowerCase('ja-JP');
  const modelFilter = sp.model ?? '';
  const statusFilter = sp.status ?? '';
  const filteredMasterRows = masterRows.filter((master) => {
    if (modelFilter && master.base_model_id !== modelFilter) return false;
    if (statusFilter && master.status !== statusFilter) return false;
    if (!query) return true;

    const modelName = modelMap.get(master.base_model_id)?.name ?? '';
    const ownerName = orgMap.get(master.owner_organization_id)?.name ?? '';
    const fireLabel = master.fire_spec_code === 'fire' ? '防火' : '非防火';
    return [master.name, modelName, ownerName, fireLabel]
      .join(' ')
      .toLocaleLowerCase('ja-JP')
      .includes(query);
  });

  return (
    <AdminPage
      title="本体マスター"
      lead="商品モデルごとに、本体基準明細・価格・公開履歴を管理します。"
      actions={<Link href="/admin/base-masters/demo" className="btn-secondary btn-sm">操作確認用サンプル</Link>}
    >
      {showQuoteManagementTabs && <QuoteManagementTabs active="base" />}
      {sp.discarded && <Alert tone="success">下書きを破棄しました。</Alert>}
      <Alert tone="info">
        既存の標準見積・旧本体内訳はまだこの新本体マスターへ自動移行していません。現在は新しく登録した本体だけを管理します。
      </Alert>

      {masterRows.length === 0 && <BaseMasterExcelDemo />}

      {masterRows.length > 0 && (
        <form method="get" className="card grid gap-3 p-4 md:grid-cols-[minmax(16rem,1fr)_14rem_12rem_auto] md:items-end">
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-semibold text-muted">検索</span>
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="本体名・モデル・管理元・防火区分"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-semibold text-muted">商品モデル</span>
            <select
              name="model"
              defaultValue={modelFilter}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
            >
              <option value="">すべて</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs font-semibold text-muted">状態</span>
            <select
              name="status"
              defaultValue={statusFilter}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
            >
              <option value="">すべて</option>
              <option value="active">有効</option>
              <option value="archived">アーカイブ</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary btn-sm">絞り込む</button>
            <Link href="/admin/base-masters" className="btn-secondary btn-sm">クリア</Link>
          </div>
          <p className="text-xs text-muted md:col-span-4">
            {filteredMasterRows.length}件表示／全{masterRows.length}件
          </p>
        </form>
      )}

      <Table minWidth="64rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>本体名</Th>
            <Th>商品モデル</Th>
            <Th>本体管理元</Th>
            <Th>防火</Th>
            <Th>状態</Th>
            <Th>現在の公開版</Th>
            <Th right>本体価格</Th>
            <Th>下書き</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {filteredMasterRows.map((master) => {
            const revisions = revisionsByMaster.get(master.id) ?? [];
            const current = revisions.find((revision) => revision.id === master.current_published_revision_id) ?? null;
            const draft = revisions.find((revision) => revision.status === 'draft') ?? null;
            const canManage = master.status === 'active' && editableOrgIds.has(master.owner_organization_id);
            return (
              <tr key={master.id}>
                <Td className="font-semibold">{master.name}</Td>
                <Td>{modelMap.get(master.base_model_id)?.name ?? '—'}</Td>
                <Td>{orgMap.get(master.owner_organization_id)?.name ?? '—'}</Td>
                <Td>{master.fire_spec_code === 'fire' ? '防火' : '非防火'}</Td>
                <Td>
                  <Badge tone={master.status === 'active' ? 'success' : 'neutral'}>
                    {master.status === 'active' ? '有効' : 'アーカイブ'}
                  </Badge>
                </Td>
                <Td>{current ? formatBaseMasterRevision(current.version) : '未公開'}</Td>
                <Td right>{current ? formatYen(current.total) : '—'}</Td>
                <Td>
                  {draft ? <Badge tone="warn">{formatBaseMasterRevision(draft.version)}・編集中</Badge> : <span className="text-muted">なし</span>}
                </Td>
                <Td right>
                  <Link href={`/admin/base-masters/${master.id}`} className="btn-secondary btn-sm">
                    {canManage ? '管理' : '参照'}
                  </Link>
                </Td>
              </tr>
            );
          })}
          {masterRows.length === 0 && (
            <tr>
              <Td colSpan={9} className="py-10 text-center text-muted">本体マスターはまだありません。</Td>
            </tr>
          )}
          {masterRows.length > 0 && filteredMasterRows.length === 0 && (
            <tr>
              <Td colSpan={9} className="py-10 text-center text-muted">条件に一致する本体マスターはありません。</Td>
            </tr>
          )}
        </tbody>
      </Table>

      {editableOrganizations.length > 0 ? (
        <BaseMasterCreateForm
          models={models.map((model) => ({ id: model.id, name: model.name }))}
          organizations={editableOrganizations}
        />
      ) : (
        <Alert tone="warn">本体を作成できる組織所属がありません。組織・所属設定を確認してください。</Alert>
      )}

      <p className="text-xs text-muted">
        更新日表示などの履歴詳細は各本体の管理画面で確認できます。発行済み見積は本体マスター更新では変更されません。
      </p>
    </AdminPage>
  );
}
