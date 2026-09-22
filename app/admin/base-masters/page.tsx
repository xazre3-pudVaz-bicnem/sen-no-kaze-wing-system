import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { BaseMasterCreateForm } from '@/components/admin/base-master-form';

const memberRank: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅・単身者',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default async function BaseMastersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireCatalogEditor('/admin/base-masters');
  const sp = await searchParams;
  const store = await getStore();
  const [models, templates] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
  ]);
  const modelMap = new Map(models.map((model) => [model.id, model]));
  const standardEstimateRows = [...templates].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (isLocalMode()) {
    return (
      <AdminPage
        title="販売基準"
        lead="本体の基準と標準見積を、一つの販売基準ワークスペースで確認します。"
      >
        <section className="card grid gap-4 p-5 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold text-brown">1. 本体基準</p>
            <h2 className="mt-1 font-semibold">本体の製造明細・本体価格</h2>
            <p className="mt-2 text-sm text-muted">公開した版を固定して履歴として残します。</p>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold text-brown">2. 標準見積</p>
            <h2 className="mt-1 font-semibold">本体に販売時の工事項目を加えた基準</h2>
            <p className="mt-2 text-sm text-muted">内外装工事・オプション・別途を含む販売時の基準です。</p>
          </div>
        </section>
        <Alert tone="info">本体基準はSupabase接続環境で利用できます。ローカルJSONモードでは参照・編集しません。</Alert>
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">標準見積</h2>
              <p className="mt-1 text-sm text-muted">現在登録されている旧分類表見積データを確認できます。</p>
            </div>
            <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">標準見積一覧を開く</Link>
          </div>
          <p className="mt-4 text-sm text-muted">{standardEstimateRows.length}件の標準見積データがあります。</p>
        </section>
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
      <AdminPage title="販売基準" lead="本体の基準と標準見積を一つの画面で確認します。">
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
      <AdminPage title="販売基準" lead="本体の基準と標準見積を一つの画面で確認します。">
        <Alert tone="danger">{revisionResult.error.message}</Alert>
      </AdminPage>
    );
  }

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
      title="販売基準"
      lead="本体の基準と標準見積を一つの画面で確認し、販売時に使う基準を管理します。"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">＋ 標準見積を作成</Link>
        </div>
      }
    >
      {sp.discarded && <Alert tone="success">下書きを破棄しました。</Alert>}

      <section className="card p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold text-brown">1. 本体基準</p>
            <h2 className="mt-1 text-lg font-semibold">本体の製造明細・本体価格</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Wing・BOXなどの本体そのものの基準です。公開した版は固定して履歴として残します。
            </p>
          </div>
          <div className="hidden items-center text-xl text-muted md:flex" aria-hidden="true">→</div>
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold text-brown">2. 標準見積</p>
            <h2 className="mt-1 text-lg font-semibold">販売時の標準構成・金額</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              本体を基準に、内外装工事・オプション・別途を加えた販売時の標準構成です。
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          画面上は一つの「販売基準」として扱いますが、内部では本体基準と標準見積を別々に管理します。
        </p>
      </section>

      <Alert tone="info">
        現在の標準見積は旧分類表見積データを使った移行・UI確認段階です。新しい標準見積の保存・公開とシミュレーターの正式切替は後工程で行います。
      </Alert>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-brown">本体基準</p>
            <h2 className="mt-1 text-xl font-semibold">本体マスター</h2>
            <p className="mt-1 text-sm text-muted">製造明細と本体価格の公開版・下書きを管理します。</p>
          </div>
          <Link href="/admin/base-masters/demo" className="btn-secondary btn-sm">操作確認用サンプル</Link>
        </div>

        <Alert tone="info">
          既存の標準見積・旧本体内訳はまだ新しい本体マスターへ自動移行していません。現在は新しく登録した本体だけを管理します。
        </Alert>

        <Table minWidth="64rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>本体名</Th>
              <Th>商品モデル</Th>
              <Th>所有組織</Th>
              <Th>防火</Th>
              <Th>状態</Th>
              <Th>公開版</Th>
              <Th right>本体価格</Th>
              <Th>下書き</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {masterRows.map((master) => {
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
                  <Td>{current ? `第${current.version}版` : '未公開'}</Td>
                  <Td right>{current ? formatYen(current.total) : '—'}</Td>
                  <Td>
                    {draft ? <Badge tone="warn">第{draft.version}版 編集中</Badge> : <span className="text-muted">なし</span>}
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
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-brown">販売時の基準</p>
            <h2 className="mt-1 text-xl font-semibold">標準見積</h2>
            <p className="mt-1 text-sm text-muted">
              本体・内外装工事・オプション・別途を含む販売時の標準構成を確認します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">すべての標準見積</Link>
            <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">＋ 新規作成</Link>
          </div>
        </div>

        {standardEstimateRows.length > 0 ? (
          <Table minWidth="54rem">
            <thead className="bg-sand/60">
              <tr>
                <Th>商品</Th>
                <Th>標準見積</Th>
                <Th>仕様</Th>
                <Th>現在の状態</Th>
                <Th right>税込金額</Th>
                <Th>更新日</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {standardEstimateRows.slice(0, 8).map((template) => (
                <tr key={template.id}>
                  <Td className="font-semibold">{modelMap.get(template.base_model_id)?.name ?? '—'}</Td>
                  <Td>
                    <p className="font-semibold">{template.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{template.source_sheet_name}</p>
                  </Td>
                  <Td>{SPEC_LABELS[template.spec_code] ?? template.spec_code}</Td>
                  <Td>
                    <Badge tone="neutral">取込済み</Badge>
                    <p className="mt-1 text-xs text-muted">本体版との正式な紐付け前</p>
                  </Td>
                  <Td right className="font-semibold">{formatYen(template.total)}</Td>
                  <Td>{formatDate(template.updated_at)}</Td>
                  <Td right>
                    <Link href={`/admin/estimate-templates/${template.id}`} className="btn-secondary btn-sm">開く</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="card px-5 py-8 text-center text-sm text-muted">標準見積はまだありません。</div>
        )}

        {standardEstimateRows.length > 8 && (
          <div className="flex justify-end">
            <Link href="/admin/estimate-templates" className="text-sm font-semibold text-brown underline underline-offset-4">
              残り{standardEstimateRows.length - 8}件を表示
            </Link>
          </div>
        )}
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-semibold">移行・旧データ</p>
          <p className="mt-1 text-sm text-muted">旧標準見積Excelは販売基準の正本ではなく、移行・確認用の補助画面として残します。</p>
        </div>
        <Link href="/admin/base-breakdown" className="btn-ghost btn-sm">旧標準見積Excelを確認</Link>
      </section>

      <p className="text-xs text-muted">
        発行済み見積は本体マスターや標準見積を更新しても変更されません。
      </p>
    </AdminPage>
  );
}
