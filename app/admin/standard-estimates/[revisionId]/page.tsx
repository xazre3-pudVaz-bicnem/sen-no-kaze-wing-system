import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { getPublicCatalog } from '@/lib/data/public-catalog';
import { buildEstimateSpecSelection, ruleContextForSpec } from '@/lib/domain/estimate-template';
import { defaultVariantIdsFor } from '@/lib/domain/preset';
import { formatYen } from '@/lib/domain/pricing';
import type { ExpenseMethod, PriceMode } from '@/lib/domain/standard-estimate-money';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from '@/lib/domain/standard-estimate-pricing';
import type { StandardEstimateEditorState, StandardLineSectionCode, StandardSectionCode } from '@/lib/domain/standard-estimate-view';
import { FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { createClient } from '@/lib/supabase/server';
import { startNextStandardEstimateRevisionAction } from '@/lib/actions/standard-estimates';
import { startStandardEstimateV25DraftAction } from '@/lib/actions/standard-estimate-v25';
import { getStandardEstimateV25Header, loadStandardEstimateV25 } from '@/lib/data/standard-estimate-v25';
import type { V25ProductCandidate } from '@/lib/domain/standard-estimate-v25-view';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { StandardEstimateEditor } from '@/components/admin/standard-estimate-editor';
import { StandardEstimateBaselineEditor, type BaselineCandidate, type BaselineItemView } from '@/components/admin/standard-estimate-baseline-editor';
import { StandardEstimateV25Editor } from '@/components/admin/standard-estimate-v25-editor';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { isQuoteSelectableProduct, productLedgerState } from '@/lib/domain/product-lifecycle';

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

  const [{ data: master }, { data: sections }, { data: lines }, { data: baseLines }, { data: baselineRows }, store] = await Promise.all([
    supabase
      .from('standard_estimate_masters')
      .select('id, base_master_id, base_model_id, spec_code, name, current_published_revision_id')
      .eq('id', revision.standard_estimate_master_id)
      .maybeSingle(),
    supabase.from('standard_estimate_revision_sections').select('section_code, expense_method').eq('revision_id', revision.id),
    supabase
      .from('standard_estimate_revision_lines')
      .select('line_key, section_code, group_label, name, quantity, unit, price_mode, cost_unit_price, unit_price, remark, sort_order')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    supabase.from('base_master_revision_lines').select('section, name, quantity, unit, unit_price, sort_order').eq('revision_id', revision.base_master_revision_id).order('sort_order'),
    supabase
      .from('standard_estimate_revision_baseline_items')
      .select('option_id, section_code, quantity, unit_price_snapshot, price_on_request_snapshot, option_name_snapshot, category_name_snapshot, sort_order')
      .eq('revision_id', revision.id)
      .order('sort_order'),
    getStore(),
  ]);
  // v2.5 の列（20261019100000）が DB に無い間は null（従来どおりの画面だけを出す）
  const v25Header = await getStandardEstimateV25Header(supabase, revision.id);
  const isV25 = v25Header?.pricing_model === 'v2.5';
  const { data: masterDraft } = await supabase
    .from('standard_estimate_revisions')
    .select('id, lock_version')
    .eq('standard_estimate_master_id', revision.standard_estimate_master_id)
    .eq('status', 'draft')
    .maybeSingle();
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

  // 標準状態の商品の候補：その仕様でお客様が選べる公開中の商品（シミュレーターと同じ絞り込み。DB でも確かめる）
  const catalogModel = models.find((model) => model.id === master?.base_model_id) ?? null;
  const bundle = catalogModel ? ((await getPublicCatalog()).bundles[catalogModel.id] ?? null) : null;
  const ruleCtx = bundle
    ? {
        options: bundle.options,
        categories: bundle.categories,
        dependencies: bundle.dependencies,
        conflicts: bundle.conflicts,
        customerCategoryMatrix: bundle.customerCategoryMatrix ?? null,
        // 標準見積は見積の場面：シミュレーター非表示の商品も使える（見積不可ではない）。取扱終了は新しく入れない
        canSelectNew: isQuoteSelectableProduct,
      }
    : null;
  const specCtx = ruleCtx && catalogModel && master ? ruleContextForSpec(ruleCtx, master.spec_code, catalogModel.slug) : null;
  const categoryById = new Map((bundle?.categories ?? []).map((category) => [category.id, category] as const));
  // 新しく入れられるのは取扱中の商品だけ。取扱終了でも、この Revision に保存済みの明細は表示・保持のために渡す（DB の保存境界と同じ）
  const savedBaselineOptionIds = new Set((baselineRows ?? []).map((item) => item.option_id));
  const baselineCandidates: BaselineCandidate[] = (specCtx?.options ?? [])
    .filter((option) => isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && savedBaselineOptionIds.has(option.id)))
    .map((option) => {
      const code = categoryById.get(option.category_id)?.code ?? '';
      return {
        id: option.id,
        name: option.name,
        categoryName: categoryById.get(option.category_id)?.name ?? '未分類',
        section: option.is_installation || code === FREE_PRODUCT_CATEGORY_CODE ? 'sitework' : INTERIOR_EXTERIOR_CATEGORY_CODES.has(code) ? 'interior_exterior' : 'option',
        price: option.price,
        priceOnRequest: option.price_on_request,
        defaultVariantChoiceIds: bundle ? defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, [option.id]) : [],
        retired: productLedgerState(option) === 'retired',
      };
    });
  const suggestedBaselineIds = ruleCtx && catalogModel && master ? buildEstimateSpecSelection(ruleCtx, catalogModel, master.spec_code) : [];
  const baselineItems: BaselineItemView[] = (baselineRows ?? []).map((item) => ({
    option_id: item.option_id,
    quantity: String(item.quantity),
    unit_price_snapshot: item.unit_price_snapshot,
    price_on_request: item.price_on_request_snapshot,
    option_name: item.option_name_snapshot,
    category_name: item.category_name_snapshot,
    section_code: item.section_code as BaselineItemView['section_code'],
  }));
  const newerBase = base?.current_published_revision_id && base.current_published_revision_id !== revision.base_master_revision_id;

  // v2.5：商品台帳の商品（その仕様でお客様が選べる取扱中の商品。保存済みの取扱終了の商品は表示・保持のために渡す）と公開中の選択肢
  const v25 = isV25 && v25Header ? await loadStandardEstimateV25(supabase, revision, v25Header) : null;
  const v25SavedOptionIds = new Set(v25?.slotOptionIds ?? []);
  const v25Candidates: V25ProductCandidate[] = v25
    ? (specCtx?.options ?? [])
        .filter((option) => isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && v25SavedOptionIds.has(option.id)))
        .map((option) => {
          const code = categoryById.get(option.category_id)?.code ?? '';
          return {
            id: option.id,
            name: option.name,
            categoryName: categoryById.get(option.category_id)?.name ?? '未分類',
            section: option.is_installation || code === FREE_PRODUCT_CATEGORY_CODE ? 'sitework' : INTERIOR_EXTERIOR_CATEGORY_CODES.has(code) ? 'interior_exterior' : 'option',
            retired: productLedgerState(option) === 'retired',
            variantGroups: (bundle?.variantGroups ?? [])
              .filter((group) => group.option_id === option.id)
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((group) => ({
                id: group.id,
                name: group.name,
                choices: (bundle?.variantChoices ?? [])
                  .filter((choice) => choice.group_id === group.id)
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((choice) => ({ id: choice.id, name: choice.name })),
              })),
          };
        })
    : [];

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
          <p className="text-xs text-muted">{isV25 ? '別途見積' : '価格未確定の行'}</p>
          <p>
            {revision.has_por ? <Badge tone="warn">{isV25 ? 'あり（合計は未確定。確定分だけを表示）' : 'あり（合計に含めない）'}</Badge> : 'なし'}
          </p>
        </div>
      </section>

      {isV25 && v25 && (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-4 text-xs" data-testid="standard-estimate-v25-rules">
          <Badge tone="navy">v2.5 の計算</Badge>
          <span className="text-muted">計算ルール {v25.rules.calcCode ?? '—'}・税ルール {v25.rules.taxCode ?? '—'}</span>
          {v25Header?.v25_pricing_complete === false && <Badge tone="danger">原価が未設定の商品があります（計算から外しています）</Badge>}
        </section>
      )}

      {v25Header && !isV25 && (
        <section className="space-y-2 rounded-lg border border-line bg-white p-4 text-sm" data-testid="standard-estimate-v25-start">
          <p className="font-semibold">v2.5 の計算で作り直す</p>
          <p className="text-xs leading-5 text-muted">
            商品台帳の商品・バリエーションから v2.5 の正式計算で金額を出す下書きを作ります。公開中の Revision は変わりません。
            今の明細は、商品台帳の商品に置き換えるまで「要見直し」の印付きで写ります（今の売価の manual・価格未確定は別途見積）。
          </p>
          {isDraft ? (
            <form action={startStandardEstimateV25DraftAction}>
              <input type="hidden" name="master_id" value={revision.standard_estimate_master_id} />
              <input type="hidden" name="expected_draft_lock_version" value={revision.lock_version} />
              <ConfirmSubmit
                className="btn-secondary btn-sm"
                dialogTitle="この下書きを v2.5 に切り替えますか？"
                message="この下書きを v2.5 の計算に切り替えます。今の明細は「要見直し」の印付きで写り、v2.5 以前の計算の下書きには戻せません。"
                confirmLabel="切り替える"
              >
                この下書きを v2.5 に切り替える
              </ConfirmSubmit>
            </form>
          ) : masterDraft ? (
            <a className="text-navy underline" href={`/admin/standard-estimates/${masterDraft.id}`}>編集中の下書きを開く</a>
          ) : revision.status === 'published' ? (
            <form action={startStandardEstimateV25DraftAction}>
              <input type="hidden" name="master_id" value={revision.standard_estimate_master_id} />
              <button type="submit" className="btn-secondary btn-sm">v2.5 の下書きを作る</button>
            </form>
          ) : null}
        </section>
      )}

      {!isDraft && revision.status === 'published' && isV25 && !masterDraft && (
        <form action={startStandardEstimateV25DraftAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm">
          <input type="hidden" name="master_id" value={revision.standard_estimate_master_id} />
          <span className="text-muted">公開版を土台に、次の v2.5 の下書きを作れます（固定した原価はそのまま引き継ぎます）。</span>
          <button type="submit" className="btn-secondary btn-sm">次の v2.5 の下書きを作成</button>
        </form>
      )}

      {!isDraft && revision.status === 'published' && !isV25 && (
        <form action={startNextStandardEstimateRevisionAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm">
          <input type="hidden" name="master_id" value={revision.standard_estimate_master_id} />
          {newerBase && <input type="hidden" name="base_master_revision_id" value={base?.current_published_revision_id ?? ''} />}
          <span className="text-muted">
            {newerBase ? '本体マスターに新しい公開版があります。新しい本体で次の Revision を作れます。' : '公開版の率・明細を引き継いで次の Revision を作れます。'}
          </span>
          <button type="submit" className="btn-secondary btn-sm">次の Revision を作成</button>
        </form>
      )}

      {isV25 && v25 && (
        <StandardEstimateV25Editor
          key={`v25-${revision.lock_version}`}
          revisionId={revision.id}
          lockVersion={revision.lock_version}
          readOnly={!isDraft}
          initial={v25.initial}
          candidates={v25Candidates}
          savedSlotAmounts={v25.savedSlotAmounts}
          savedLineAmounts={v25.savedLineAmounts}
          preview={v25.preview}
        />
      )}

      {/* 保存のたびに版が進むので、保存後は DB の内容（新しい行の line_key など）で作り直す */}
      {!isV25 && (
      <StandardEstimateEditor
        key={revision.lock_version}
        revisionId={revision.id}
        lockVersion={revision.lock_version}
        readOnly={!isDraft}
        taxRate={String(revision.tax_rate)}
        baseLines={(baseLines ?? []).map((line) => ({ section: line.section, name: line.name, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price }))}
        initial={initial}
      />
      )}

      {!isV25 && (
      <StandardEstimateBaselineEditor
        key={`baseline-${revision.lock_version}`}
        revisionId={revision.id}
        lockVersion={revision.lock_version}
        readOnly={!isDraft}
        items={baselineItems}
        candidates={baselineCandidates}
        suggestedOptionIds={suggestedBaselineIds}
      />
      )}
    </AdminPage>
  );
}
