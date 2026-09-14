import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { BaseMasterCreateForm } from '@/components/admin/base-master-form';

const memberRank: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export default async function BaseMastersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireCatalogEditor('/admin/base-masters');
  const sp = await searchParams;
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });

  if (isLocalMode()) {
    return (
      <AdminPage
        title="本体マスター"
        lead="本体の製造明細・価格をRevision管理します。"
      >
        <Alert tone="info">この画面はSupabase接続環境で利用できます。ローカルJSONモードでは参照・編集しません。</Alert>
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
    return (
      <AdminPage title="本体マスター" lead="本体の製造明細・価格をRevision管理します。">
        <Alert tone="danger">{loadError.message}</Alert>
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
    return (
      <AdminPage title="本体マスター" lead="本体の製造明細・価格をRevision管理します。">
        <Alert tone="danger">{revisionResult.error.message}</Alert>
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

  return (
    <AdminPage
      title="本体マスター"
      lead="Wing・BOXなどの商品モデルの下に、会社ごとの本体製造明細と価格を版管理します。"
    >
      {sp.discarded && <Alert tone="success">Draftを破棄しました。</Alert>}

      <Table minWidth="64rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>本体名</Th>
            <Th>ベースモデル</Th>
            <Th>所有組織</Th>
            <Th>防火</Th>
            <Th>状態</Th>
            <Th>現在版</Th>
            <Th right>本体価格</Th>
            <Th>Draft</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {masterRows.map((master) => {
            const revisions = revisionsByMaster.get(master.id) ?? [];
            const current = revisions.find((revision) => revision.id === master.current_published_revision_id) ?? null;
            const draft = revisions.find((revision) => revision.status === 'draft') ?? null;
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
                <Td>{current ? `v${current.version}` : '未公開'}</Td>
                <Td right>{current ? formatYen(current.total) : '—'}</Td>
                <Td>
                  {draft ? <Badge tone="warn">v{draft.version}編集中</Badge> : <span className="text-muted">なし</span>}
                </Td>
                <Td right>
                  <Link href={`/admin/base-masters/${master.id}`} className="btn-secondary btn-sm">管理</Link>
                </Td>
              </tr>
            );
          })}
          {masterRows.length === 0 && (
            <tr>
              <Td colSpan={9} className="py-10 text-center text-muted">本体マスターはまだありません。</Td>
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
