import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import type { ExpenseMethod, PriceMode } from '@/lib/domain/standard-estimate-money';
import type { StandardEstimateEditorState, StandardLineSectionCode, StandardSectionCode } from '@/lib/domain/standard-estimate-view';
import { createClient } from '@/lib/supabase/server';
import { startNextStandardEstimateRevisionAction } from '@/lib/actions/standard-estimates';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { StandardEstimateEditor } from '@/components/admin/standard-estimate-editor';

export const metadata: Metadata = { title: '標準見積の Revision | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = { draft: '下書き', published: '公開中', superseded: '過去の公開版' };

export default async function StandardEstimateRevisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ revisionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin('/admin/standard-estimates');
  const { revisionId } = await params;
  const sp = await searchParams;
  if (isLocalMode()) {
    return (
      <AdminPage title="標準見積">
        <Alert tone="info">この画面はSupabase接続環境で利用できます。</Alert>
      </AdminPage>
    );
  }

  const supabase = await createClient();
  const { data: revision, error } = await supabase
    .from('standard_estimate_revisions')
    .select('id, standard_estimate_master_id, version, status, base_master_revision_id, tax_rate, sales_fee_rate, expense_rate, markup_rate, standard_adjustment_amount, standard_adjustment_reason, subtotal, tax, total, cost_total, has_por, lock_version, published_at')
    .eq('id', revisionId)
    .maybeSingle();
  if (error) {
    return (
      <AdminPage title="標準見積">
        <Alert tone="danger">{error.message}</Alert>
      </AdminPage>
    );
  }
  if (!revision) notFound();

  const [{ data: master }, { data: sections }, { data: lines }, { data: baseLines }, store] = await Promise.all([
    supabase.from('standard_estimate_masters').select('id, base_master_id, name, current_published_revision_id').eq('id', revision.standard_estimate_master_id).maybeSingle(),
    supabase.from('standard_estimate_revision_sections').select('section_code, expense_method').eq('revision_id', revision.id),
    supabase
      .from('standard_estimate_revision_lines')
      .select('line_key, section_code, group_label, name, quantity, unit, price_mode, cost_unit_price, unit_price, remark, sort_order')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    supabase.from('base_master_revision_lines').select('section, name, quantity, unit, unit_price, sort_order').eq('revision_id', revision.base_master_revision_id).order('sort_order'),
    getStore(),
  ]);
  const { data: base } = await supabase
    .from('base_masters')
    .select('id, name, fire_spec_code, matrix_row_id, current_published_revision_id')
    .eq('id', master?.base_master_id ?? '')
    .maybeSingle();
  const [matrix, models] = await Promise.all([store.getSpecMatrix(), store.listModels({ includeDraft: true })]);
  const row = matrix?.rows.find((candidate) => candidate.id === base?.matrix_row_id);
  const identity = row
    ? `${models.find((model) => model.id === row.base_model_id)?.name ?? ''} / ${matrix?.specs.find((spec) => spec.code === row.spec_code)?.label ?? row.spec_code} / ${matrix?.sizes.find((size) => size.code === row.size_code)?.label ?? row.size_code} / ${base?.fire_spec_code === 'fire' ? '防火' : '非防火'}`
    : master?.name ?? '標準見積';

  const methodOf = (code: StandardSectionCode): ExpenseMethod =>
    ((sections ?? []).find((section) => section.section_code === code)?.expense_method === 'none' ? 'none' : 'rate');
  const initial: StandardEstimateEditorState = {
    sales_fee_rate: String(revision.sales_fee_rate),
    expense_rate: String(revision.expense_rate),
    markup_rate: String(revision.markup_rate),
    adjustment: revision.standard_adjustment_amount,
    adjustment_reason: revision.standard_adjustment_reason ?? '',
    section_methods: { base: methodOf('base'), interior_exterior: methodOf('interior_exterior'), option: methodOf('option'), sitework: methodOf('sitework') },
    lines: (lines ?? []).map((line) => ({
      line_key: line.line_key,
      section_code: line.section_code as StandardLineSectionCode,
      group_label: line.group_label,
      name: line.name,
      quantity: String(line.quantity),
      unit: line.unit,
      price_mode: line.price_mode as PriceMode,
      cost_unit_price: line.cost_unit_price,
      unit_price: line.price_mode === 'manual' ? line.unit_price : null,
      remark: line.remark,
    })),
  };
  const isDraft = revision.status === 'draft';
  const newerBase = base?.current_published_revision_id && base.current_published_revision_id !== revision.base_master_revision_id;

  return (
    <AdminPage
      title={identity}
      lead={`標準見積 第${revision.version}版`}
      actions={<Badge tone={isDraft ? 'warn' : revision.status === 'published' ? 'success' : 'neutral'}>{STATUS_LABEL[revision.status] ?? revision.status}</Badge>}
    >
      <BackLink href="/admin/standard-estimates" label="標準見積の一覧へ戻る" />
      {sp.created && <Alert tone="success">下書きを作成しました。</Alert>}
      <section className="grid gap-2 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">保存済みの税込合計</p>
          <p className="font-semibold tabular-nums">{formatYen(revision.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">税抜・消費税</p>
          <p className="tabular-nums">{formatYen(revision.subtotal)}・{formatYen(revision.tax)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">内部原価（本部だけ）</p>
          <p className="tabular-nums">{formatYen(revision.cost_total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">価格未確定の行</p>
          <p>{revision.has_por ? <Badge tone="warn">あり（合計に含めない）</Badge> : 'なし'}</p>
        </div>
      </section>

      {!isDraft && revision.status === 'published' && (
        <form action={startNextStandardEstimateRevisionAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm">
          <input type="hidden" name="master_id" value={revision.standard_estimate_master_id} />
          {newerBase && <input type="hidden" name="base_master_revision_id" value={base?.current_published_revision_id ?? ''} />}
          <span className="text-muted">
            {newerBase ? '本体マスターに新しい公開版があります。新しい本体で次の Revision を作れます。' : '公開版の率・明細を引き継いで次の Revision を作れます。'}
          </span>
          <button type="submit" className="btn-secondary btn-sm">次の Revision を作成</button>
        </form>
      )}

      {/* 保存のたびに版が進むので、保存後は DB の内容（新しい行の line_key など）で作り直す */}
      <StandardEstimateEditor
        key={revision.lock_version}
        revisionId={revision.id}
        lockVersion={revision.lock_version}
        readOnly={!isDraft}
        taxRate={String(revision.tax_rate)}
        baseLines={(baseLines ?? []).map((line) => ({ section: line.section, name: line.name, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price }))}
        initial={initial}
      />
    </AdminPage>
  );
}
