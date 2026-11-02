import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog } from '@/lib/domain/types';
import { isQuoteSelectableProduct } from '@/lib/domain/product-lifecycle';
import { formatYen } from '@/lib/domain/pricing';
import { EMPTY_POR_SELECTION_STATE } from '@/lib/domain/quote-por';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';
import { DealerRevisionForm } from '@/components/admin/dealer-forms';
import { QuoteV25RevisionForm, type QuoteV25Product } from '@/components/admin/quote-v25-revision-form';
import { Badge } from '@/components/ui';
import { defaultVariantIdsFor } from '@/lib/domain/preset';
import { productSpecCodesAllow } from '@/lib/domain/customer-category-applicability';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from '@/lib/domain/standard-estimate-pricing';
import { FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';

export default async function AdminQuoteRevisionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const store = await getStore();
  const detail = await store.getQuote(id, actor);
  if (!detail) notFound();

  const { quote, request } = detail;
  const canAccess = actor.role === 'admin' || quote.dealer_id === actor.id;
  const isLegacyWebRevision =
    quote.configuration_id !== null &&
    quote.status === 'issued' &&
    canAccess;

  if (!isLegacyWebRevision) notFound();

  const [categories, options, porState, v25Context] = await Promise.all([
    store.listCategories(),
    store.listOptions(),
    // お客様が選んだ別途見積の商品と、自分の確認が済んでいるか（D1 までの暫定。発行時に DB が確かめる）。
    // 読み込めないときは画面を落とさず、発行を止めて再読み込みを案内する
    store.getQuotePorSelections(quote.id, actor).catch(() => ({ ...EMPTY_POR_SELECTION_STATE, loadError: true })),
    // v2.5 の標準見積から作った見積（v2.5 PR-D1）は、固定した版の v2.5 の決まりで発行する画面にする
    quote.pricing_model === 'v2.5' ? store.getQuoteV25Context(quote.id, actor) : Promise.resolve(null),
  ]);

  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));
  // 商品の候補（新しく選ぶ）は取扱中の商品だけ。取扱終了の商品は新しい版で選べない（発行時も DB が止める）
  const products = options
    .filter(isQuoteSelectableProduct)
    .map((option) => ({
      id: option.id,
      baseModelId: option.base_model_id,
      categoryId: option.category_id,
      categoryCode: categoryMap.get(option.category_id)?.code ?? '',
      categoryName: categoryMap.get(option.category_id)?.name ?? '未分類',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      sizeNote: option.size_note ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
      specCodes: option.spec_codes ?? [],
    }));

  const caseName =
    request?.case_name?.trim() ||
    request?.contact.company_name ||
    request?.contact.full_name ||
    quote.customer_company ||
    quote.customer_name;

  const returnHref = `/admin/quotes?case=${encodeURIComponent(quote.id)}&tab=estimate#case-workspace`;

  // v2.5 の見積：商品台帳の商品は、見積に固定した版の売価（原価は渡さない）。この商品モデル・仕様で新しく選べる商品だけ
  let v25Products: QuoteV25Product[] = [];
  if (v25Context) {
    const bundle = await store.getCatalogBundle(v25Context.baseModelId, { includeDraft: false });
    const categoryById = new Map((bundle?.categories ?? []).map((category) => [category.id, category] as const));
    const selectable = (bundle?.options ?? []).filter(
      (option) => isQuoteSelectableProduct(option) && productSpecCodesAllow(option.spec_codes ?? [], v25Context.specCode, v25Context.modelSlug)
    );
    const groups = bundle?.variantGroups ?? [];
    const choices = bundle?.variantChoices ?? [];
    const defaults = new Map(selectable.map((option) => [option.id, defaultVariantIdsFor(groups, choices, [option.id])] as const));
    const units = await store
      .getQuoteV25Units(quote.id, selectable.map((option) => ({ option_id: option.id, choice_ids: defaults.get(option.id) ?? [] })), actor)
      .catch(() => selectable.map(() => null));
    v25Products = selectable.map((option, index) => {
      const code = categoryById.get(option.category_id)?.code ?? '';
      return {
        id: option.id,
        name: option.name,
        categoryName: categoryById.get(option.category_id)?.name ?? '未分類',
        section: option.is_installation || code === FREE_PRODUCT_CATEGORY_CODE ? 'sitework' : INTERIOR_EXTERIOR_CATEGORY_CODES.has(code) ? 'interior_exterior' : 'option',
        manufacturer: option.manufacturer ?? '',
        modelNo: option.model_no ?? '',
        groups: groups
          .filter((group) => group.option_id === option.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((group) => ({
            id: group.id,
            name: group.name,
            required: group.is_required,
            choices: choices.filter((choice) => choice.group_id === group.id).sort((a, b) => a.sort_order - b.sort_order).map((choice) => ({ id: choice.id, name: choice.name })),
          })),
        defaultChoiceIds: defaults.get(option.id) ?? [],
        defaultUnit: units[index] ?? null,
      };
    });
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-3" data-testid="legacy-revision-edit-page">
      <QuoteManagementTabs active="case" />

      <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#f7faf8] px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">第{quote.revision + 1}版 見積編集</h1>
              <Badge tone="neutral">未発行</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              発行済みの第{quote.revision}版は変更せず、次の版として編集します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={returnHref} className="btn-secondary btn-sm" data-testid="revision-edit-return-case">
              案件へ戻る
            </Link>
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary btn-sm"
            >
              現在の見積PDF
            </a>
          </div>
        </div>

        <div className="grid gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-[11px] sm:grid-cols-2 lg:grid-cols-5">
          <div><span className="text-muted">案件</span><strong className="ml-1">{caseName}</strong></div>
          <div><span className="text-muted">お客様</span><strong className="ml-1">{request?.contact.full_name || quote.customer_name}</strong></div>
          <div><span className="text-muted">商品モデル</span><strong className="ml-1">{quote.base_model_name}</strong></div>
          <div><span className="text-muted">現在の発行済み見積</span><strong className="ml-1">第{quote.revision}版</strong></div>
          <div><span className="text-muted">現在の見積金額</span><strong className="ml-1">{formatYen(quote.total)}</strong></div>
        </div>

        {v25Context ? (
          <QuoteV25RevisionForm
            quote={quote}
            items={detail.items}
            canEditBase={canEditCatalog(actor.role)}
            context={v25Context}
            products={v25Products}
            porState={porState}
          />
        ) : quote.pricing_model === 'v2.5' ? (
          <p className="px-4 py-6 text-sm text-danger">
            v2.5 の標準見積から作った見積です。DB の更新（v2.5 の正式見積）が済むまで、この画面からは発行できません。
          </p>
        ) : (
          <DealerRevisionForm
            quote={quote}
            items={detail.items}
            canEditBase={canEditCatalog(actor.role)}
            products={products}
            baseModelId={quote.base_model_id ?? ''}
            specCode={quote.spec_code ?? ''}
            porState={porState}
            optionFlags={options.map((option) => ({ id: option.id, price: option.price, priceOnRequest: option.price_on_request }))}
            sheetMode
          />
        )}
      </section>
    </div>
  );
}
