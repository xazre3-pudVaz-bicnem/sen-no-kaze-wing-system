import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { Alert } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { StandardQuoteCaseForm, type StandardQuoteChoice } from '@/components/admin/standard-quote-case-form';

export const metadata: Metadata = { title: '標準見積から見積書を作成 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

type MasterRow = { id: string; base_master_id: string; name: string; current_published_revision_id: string | null };
type RevisionRow = { id: string; standard_estimate_master_id: string; version: number; total: number; has_por: boolean };
type BaseMasterRow = { id: string; name: string; fire_spec_code: string; matrix_row_id: string | null };

/** 公開中の標準見積から、案件と見積下書きを作る（本部だけ） */
export default async function NewStandardQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin('/admin/quotes/standard-drafts/new');
  const sp = await searchParams;
  if (isLocalMode()) {
    return (
      <AdminPage title="標準見積から見積書を作成">
        <Alert tone="info">この画面はSupabase接続環境で利用できます。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const store = await getStore();
  const [matrix, models, masters, revisions, baseMasters] = await Promise.all([
    store.getSpecMatrix(),
    store.listModels({ includeDraft: true }),
    supabase.from('standard_estimate_masters').select('id, base_master_id, name, current_published_revision_id').eq('status', 'active'),
    supabase.from('standard_estimate_revisions').select('id, standard_estimate_master_id, version, total, has_por').eq('status', 'published'),
    supabase.from('base_masters').select('id, name, fire_spec_code, matrix_row_id'),
  ]);
  const loadError = masters.error || revisions.error || baseMasters.error;
  if (loadError) {
    return (
      <AdminPage title="標準見積から見積書を作成">
        <Alert tone="danger">{loadError.message}</Alert>
      </AdminPage>
    );
  }

  const baseRows = (baseMasters.data ?? []) as BaseMasterRow[];
  const revisionRows = (revisions.data ?? []) as RevisionRow[];
  const identity = (base: BaseMasterRow | undefined, fallback: string) => {
    const row = matrix?.rows.find((candidate) => candidate.id === base?.matrix_row_id);
    if (!row) return fallback;
    const model = models.find((candidate) => candidate.id === row.base_model_id);
    const spec = matrix?.specs.find((candidate) => candidate.code === row.spec_code);
    const size = matrix?.sizes.find((candidate) => candidate.code === row.size_code);
    return `${model?.name ?? '不明な機種'} / ${spec?.label ?? row.spec_code} / ${size?.label ?? row.size_code} / ${base?.fire_spec_code === 'fire' ? '防火' : '非防火'}`;
  };
  const choices: StandardQuoteChoice[] = ((masters.data ?? []) as MasterRow[])
    .map((master) => {
      const published = revisionRows.find((revision) => revision.id === master.current_published_revision_id);
      if (!published) return null;
      return {
        revisionId: published.id,
        label: identity(baseRows.find((base) => base.id === master.base_master_id), master.name),
        version: published.version,
        total: published.total,
        hasPor: published.has_por,
      };
    })
    .filter((choice): choice is StandardQuoteChoice => choice !== null)
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  const selected = sp.revision && choices.some((choice) => choice.revisionId === sp.revision) ? sp.revision : null;

  return (
    <AdminPage
      title="標準見積から見積書を作成"
      lead="公開中の標準見積（機種・用途・サイズ・防火）を選ぶと、その率・明細を写した見積下書きを作ります。下書きで明細・率を調整してから発行してください。"
    >
      <BackLink href="/admin/quotes" label="案件管理へ戻る" />
      {choices.length === 0 ? (
        <Alert tone="warn">
          公開中の標準見積がありません。<Link href="/admin/standard-estimates" className="underline">標準見積</Link>で公開してから作成してください。
        </Alert>
      ) : (
        <StandardQuoteCaseForm choices={choices} selectedRevisionId={selected} />
      )}
    </AdminPage>
  );
}
