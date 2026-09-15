import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCatalogEditor } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { resolveBaseMasterDetailView } from '@/lib/domain/base-master-detail';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { StartBaseMasterDraftForm } from '@/components/admin/base-master-form';
import { BaseMasterDraftEditor, type BaseMasterRevisionView } from '@/components/admin/base-master-revision-form';
import type { BaseMasterRevisionLine } from '@/components/admin/base-master-lines';

function revisionTone(status: string): 'success' | 'warn' | 'neutral' {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'warn';
  return 'neutral';
}

function revisionLabel(status: string) {
  if (status === 'published') return '公開中';
  if (status === 'draft') return 'Draft';
  return '旧版';
}

function readOnlyRevisionTitle(revision: BaseMasterRevisionView) {
  if (revision.status === 'draft') return `Draft v${revision.version}（参照のみ）`;
  if (revision.status === 'published') return `公開版 v${revision.version}`;
  return `旧版 v${revision.version}`;
}

export default async function BaseMasterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireCatalogEditor('/admin/base-masters');
  const { id } = await params;
  const sp = await searchParams;

  if (isLocalMode()) {
    return (
      <AdminPage title="本体マスター">
        <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
        <Alert tone="info">この画面はSupabase接続環境で利用できます。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const { data: master, error: masterError } = await supabase
    .from('base_masters')
    .select('id, base_model_id, owner_organization_id, name, fire_spec_code, status, current_published_revision_id, cloned_from_revision_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (masterError) {
    return (
      <AdminPage title="本体マスター">
        <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
        <Alert tone="danger">{masterError.message}</Alert>
      </AdminPage>
    );
  }
  if (!master) notFound();

  const [
    { data: model },
    { data: owner },
    { data: revisions, error: revisionError },
    { data: canEdit, error: canEditError },
    { data: canViewOwned, error: canViewOwnedError },
  ] = await Promise.all([
    supabase.from('base_models').select('id, name, slug').eq('id', master.base_model_id).maybeSingle(),
    supabase.from('organizations').select('id, name, organization_type').eq('id', master.owner_organization_id).maybeSingle(),
    supabase
      .from('base_master_revisions')
      .select('id, base_master_id, version, status, expense_method, expense_rate, expense_amount, line_subtotal, total, published_at, created_at, updated_at')
      .eq('base_master_id', master.id)
      .order('version', { ascending: false }),
    supabase.rpc('can_edit_base_master', { p_base_master_id: master.id }),
    supabase.rpc('can_view_owned_base_master', { p_base_master_id: master.id }),
  ]);

  const loadError = revisionError || canEditError || canViewOwnedError;
  if (loadError) {
    return (
      <AdminPage title={master.name}>
        <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
        <Alert tone="danger">{loadError.message}</Alert>
      </AdminPage>
    );
  }

  const revisionRows = (revisions ?? []) as BaseMasterRevisionView[];
  const draft = revisionRows.find((revision) => revision.status === 'draft') ?? null;
  const current =
    revisionRows.find((revision) => revision.id === master.current_published_revision_id) ??
    revisionRows.find((revision) => revision.status === 'published') ??
    null;

  let migrationDraftOutput: {
    id: string;
    migration_batch_id: string;
    fire_spec_review_required: boolean;
    confirmed_fire_spec_code: string | null;
  } | null = null;
  let migrationBatchStatus: string | null = null;

  if (draft) {
    const { data: output, error: migrationOutputError } = await supabase
      .from('legacy_base_migration_draft_outputs')
      .select('id,migration_batch_id,fire_spec_review_required,confirmed_fire_spec_code')
      .eq('revision_id', draft.id)
      .maybeSingle();

    if (migrationOutputError) {
      return (
        <AdminPage title={master.name}>
          <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
          <Alert tone="danger">{migrationOutputError.message}</Alert>
        </AdminPage>
      );
    }

    migrationDraftOutput = output as typeof migrationDraftOutput;

    if (migrationDraftOutput) {
      const { data: migrationBatch, error: migrationBatchError } = await supabase
        .from('legacy_base_migration_batches')
        .select('status')
        .eq('id', migrationDraftOutput.migration_batch_id)
        .maybeSingle();

      if (migrationBatchError) {
        return (
          <AdminPage title={master.name}>
            <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
            <Alert tone="danger">{migrationBatchError.message}</Alert>
          </AdminPage>
        );
      }
      migrationBatchStatus = migrationBatch?.status ? String(migrationBatch.status) : null;
    }
  }

  const migrationDraftLocked = Boolean(migrationDraftOutput);

  const detailView = resolveBaseMasterDetailView({
    canEdit: Boolean(canEdit),
    canViewOwned: Boolean(canViewOwned),
    draftId: draft?.id ?? null,
    currentId: current?.id ?? null,
    requestedRevisionId: sp.revision ?? null,
    visibleRevisionIds: revisionRows.map((revision) => revision.id),
  });

  const lineRevisionIds = [
    ...(detailView.editableRevisionId ? [detailView.editableRevisionId] : []),
    ...detailView.readOnlyRevisionIds,
    ...(migrationDraftLocked && draft ? [draft.id] : []),
  ];
  const uniqueLineRevisionIds = [...new Set(lineRevisionIds)];

  const linesByRevision = new Map<string, BaseMasterRevisionLine[]>();
  if (uniqueLineRevisionIds.length > 0) {
    const { data, error } = await supabase
      .from('base_master_revision_lines')
      .select('id, revision_id, line_key, section, name, quantity, unit, unit_price, amount, remark, sort_order')
      .in('revision_id', uniqueLineRevisionIds)
      .order('sort_order');

    if (error) {
      return (
        <AdminPage title={master.name}>
          <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />
          <Alert tone="danger">{error.message}</Alert>
        </AdminPage>
      );
    }

    for (const raw of data ?? []) {
      const line = {
        ...raw,
        quantity: Number(raw.quantity),
        unit_price: Number(raw.unit_price),
        amount: Number(raw.amount),
        sort_order: Number(raw.sort_order),
      } as BaseMasterRevisionLine;
      const rows = linesByRevision.get(line.revision_id) ?? [];
      rows.push(line);
      linesByRevision.set(line.revision_id, rows);
    }
  }

  const editable = detailView.accessKind === 'editor';
  const identityLocked = revisionRows.some((revision) => revision.status === 'published' || revision.status === 'superseded');
  const readonlyRevisions = detailView.readOnlyRevisionIds
    .map((revisionId) => revisionRows.find((revision) => revision.id === revisionId))
    .filter((revision): revision is BaseMasterRevisionView => Boolean(revision));

  return (
    <AdminPage
      title={master.name}
      lead={`${model?.name ?? '—'}／${owner?.name ?? '—'}／${master.fire_spec_code === 'fire' ? '防火' : '非防火'}`}
    >
      <BackLink href="/admin/base-masters" label="本体マスター一覧へ戻る" />

      {sp.created && <Alert tone="success">本体とDraft v1を作成しました。明細を登録してください。</Alert>}
      {sp.saved && <Alert tone="success">Draftを保存しました。</Alert>}
      {sp.published && <Alert tone="success">新しいRevisionを公開しました。</Alert>}
      {sp.draft && <Alert tone="success">公開版から新しいDraftを作成しました。</Alert>}

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-muted">ベースモデル</p>
          <p className="mt-1 font-semibold">{model?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">所有組織</p>
          <p className="mt-1 font-semibold">{owner?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">現在公開版</p>
          <p className="mt-1 font-semibold">{current ? `v${current.version}・${formatYen(current.total)}` : '未公開'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">編集中</p>
          <p className="mt-1 font-semibold">{draft ? `Draft v${draft.version}` : 'なし'}</p>
        </div>
      </section>

      {detailView.accessKind === 'owner_viewer' && (
        <Alert tone="info">この本体は所有組織の参照権限です。Draftと公開版を確認できますが、編集・公開はできません。</Alert>
      )}
      {detailView.accessKind === 'shared_viewer' && (
        <Alert tone="info">この本体は利用できますが、編集・公開はできません。Draftは表示されません。</Alert>
      )}

      {migrationDraftLocked && draft && migrationDraftOutput && (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold">旧本体移行Draft</h2>
            <p className="mt-1 text-sm text-muted">
              このDraftは旧本体移行の検算中です。明細・金額・諸費用を直接変更できません。
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">防火区分</p>
              <p className="mt-1 font-semibold">
                {migrationDraftOutput.fire_spec_review_required
                  ? '要確認'
                  : migrationDraftOutput.confirmed_fire_spec_code === 'fire'
                    ? '確認済み・防火'
                    : '確認済み・非防火'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">移行状態</p>
              <p className="mt-1 font-semibold">{migrationBatchStatus ?? '—'}</p>
            </div>
          </div>
          <Link
            href={'/admin/base-migration?batch=' + migrationDraftOutput.migration_batch_id}
            className="btn-secondary btn-sm inline-flex"
          >
            旧本体移行監査を開く
          </Link>
        </section>
      )}

      {migrationDraftLocked && draft && (
        <section id={'revision-' + draft.id} className="card overflow-x-auto">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Draft v{draft.version}（移行監査・参照のみ）</h2>
            <p className="mt-1 text-xs text-muted">
              {(linesByRevision.get(draft.id) ?? []).length}行・明細合計 {formatYen(draft.line_subtotal)}・本体価格計 {formatYen(draft.total)}
            </p>
          </div>
          {(linesByRevision.get(draft.id) ?? []).length > 0 ? (
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-sand/60 text-left text-xs text-muted">
                <tr><Th>工事区分</Th><Th>品名</Th><Th right>数量</Th><Th>単位</Th><Th right>単価</Th><Th right>金額</Th><Th>備考</Th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(linesByRevision.get(draft.id) ?? []).map((line) => (
                  <tr key={line.id}>
                    <Td>{line.section}</Td>
                    <Td className="font-medium">{line.name}</Td>
                    <Td right>{line.quantity}</Td>
                    <Td>{line.unit ?? ''}</Td>
                    <Td right>{formatYen(line.unit_price)}</Td>
                    <Td right>{formatYen(line.amount)}</Td>
                    <Td className="text-xs text-muted">{line.remark ?? ''}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">このRevisionには明細がありません。</p>
          )}
        </section>
      )}

      {editable && draft && !migrationDraftLocked && detailView.editableRevisionId === draft.id && (
        <BaseMasterDraftEditor
          key={draft.id + ':' + (sp.saved ?? 'initial')}
          master={{
            id: master.id,
            name: master.name,
            fire_spec_code: master.fire_spec_code as 'non_fire' | 'fire',
          }}
          revision={draft}
          lines={linesByRevision.get(draft.id) ?? []}
          identityLocked={identityLocked}
        />
      )}

      {editable && !draft && current && (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold">公開版 v{current.version}</h2>
            <p className="mt-1 text-sm text-muted">公開済みRevisionは直接変更しません。変更するときは新しいDraftを作成します。</p>
          </div>
          <StartBaseMasterDraftForm masterId={master.id} />
        </section>
      )}

      {readonlyRevisions.map((revision) => {
        const lines = linesByRevision.get(revision.id) ?? [];
        return (
          <section key={revision.id} id={`revision-${revision.id}`} className="card overflow-x-auto">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-semibold">{readOnlyRevisionTitle(revision)}</h2>
              <p className="mt-1 text-xs text-muted">
                {lines.length}行・明細合計 {formatYen(revision.line_subtotal)}・本体価格計 {formatYen(revision.total)}
              </p>
            </div>
            {lines.length > 0 ? (
              <table className="w-full min-w-[48rem] text-sm">
                <thead className="bg-sand/60 text-left text-xs text-muted">
                  <tr><Th>工事区分</Th><Th>品名</Th><Th right>数量</Th><Th>単位</Th><Th right>単価</Th><Th right>金額</Th><Th>備考</Th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <Td>{line.section}</Td>
                      <Td className="font-medium">{line.name}</Td>
                      <Td right>{line.quantity}</Td>
                      <Td>{line.unit ?? ''}</Td>
                      <Td right>{formatYen(line.unit_price)}</Td>
                      <Td right>{formatYen(line.amount)}</Td>
                      <Td className="text-xs text-muted">{line.remark ?? ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">このRevisionには明細がありません。</p>
            )}
          </section>
        );
      })}

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Revision履歴</h2>
          <p className="mt-1 text-sm text-muted">公開済みの版は内容を固定して残します。各版の明細も参照できます。</p>
        </div>
        <Table minWidth="54rem">
          <thead className="bg-sand/60">
            <tr><Th>版</Th><Th>状態</Th><Th right>明細合計</Th><Th right>諸費用</Th><Th right>本体価格計</Th><Th>公開日</Th><Th></Th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {revisionRows.map((revision) => {
              const isEditing = editable && draft?.id === revision.id;
              const isShown = detailView.readOnlyRevisionIds.includes(revision.id);
              return (
                <tr key={revision.id}>
                  <Td className="font-semibold">v{revision.version}</Td>
                  <Td><Badge tone={revisionTone(revision.status)}>{revisionLabel(revision.status)}</Badge></Td>
                  <Td right>{formatYen(revision.line_subtotal)}</Td>
                  <Td right>{formatYen(revision.expense_amount)}</Td>
                  <Td right>{formatYen(revision.total)}</Td>
                  <Td>{revision.published_at ? formatDate(revision.published_at) : '—'}</Td>
                  <Td right>
                    {isEditing ? (
                      <span className="text-xs text-muted">編集中</span>
                    ) : (
                      <Link
                        href={`/admin/base-masters/${master.id}?revision=${revision.id}#revision-${revision.id}`}
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {isShown ? '表示中' : '明細を見る'}
                      </Link>
                    )}
                  </Td>
                </tr>
              );
            })}
            {revisionRows.length === 0 && <tr><Td colSpan={7} className="py-8 text-center text-muted">Revisionがありません。</Td></tr>}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
