import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteOptionAction } from '@/lib/actions/admin';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, type OptionConflict, type OptionDependency, type OptionVariantChoice, type OptionVariantGroup } from '@/lib/domain/types';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { OptionMediaManager } from '@/components/admin/option-media-manager';
import { OptionVariantManager, OptionVariantPricing } from '@/components/admin/option-variant-manager';
import { SmartImage } from '@/components/ui/smart-image';

type RegistrationStep = 'info' | 'preview';

function publishedRows(groups: OptionVariantGroup[], choices: OptionVariantChoice[]) {
  return groups
    .filter((group) => group.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map((group) => ({
      group,
      choices: choices
        .filter((choice) => choice.group_id === group.id && choice.status === 'published')
        .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    }));
}

export default async function EditOptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireStaff();
  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) notFound();

  const step: RegistrationStep = sp.step === 'preview' ? 'preview' : 'info';
  const returnTo =
    typeof sp.return_to === 'string' && sp.return_to.startsWith('/admin/') && !sp.return_to.startsWith('//')
      ? sp.return_to
      : undefined;

  const [categories, models, options, variants] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.getOptionVariants(id),
  ]);
  const category = categories.find((row) => row.id === option.category_id);
  const canEditThisOption = canEditCatalog(actor.role) || (category?.code === FREE_PRODUCT_CATEGORY_CODE && option.owner_id === actor.id);
  const catalogEditor = canEditCatalog(actor.role);

  const deps: OptionDependency[] = [];
  const confs: OptionConflict[] = [];
  for (const model of models) {
    const bundle = await store.getCatalogBundle(model.id, { includeDraft: true });
    if (!bundle) continue;
    for (const dependency of bundle.dependencies) {
      if (dependency.option_id === id && !deps.some((row) => row.id === dependency.id)) deps.push(dependency);
    }
    for (const conflict of bundle.conflicts) {
      if (conflict.option_id === id && !confs.some((row) => row.id === conflict.id)) confs.push(conflict);
    }
  }

  const customerRows = publishedRows(variants.groups, variants.choices);
  const stepHref = (key: RegistrationStep) => {
    const params = new URLSearchParams({ step: key });
    if (returnTo) params.set('return_to', returnTo);
    return `?${params.toString()}`;
  };

  return (
    <AdminPage
      title={option.name}
      lead={option.code}
      actions={catalogEditor ? (
        <form action={deleteOptionAction}>
          <input type="hidden" name="id" value={option.id} />
          <ConfirmSubmit
            message={`「${option.name}」を削除しますか？保存済みの仕様で使用中の場合は削除できません。`}
            className="btn-ghost btn-sm text-danger"
          >
            削除
          </ConfirmSubmit>
        </form>
      ) : undefined}
    >
      <BackLink href={returnTo ?? (category?.code === FREE_PRODUCT_CATEGORY_CODE ? '/admin/free-products' : '/admin/options')} label={returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る'} />
      <FlashMessages sp={sp} />

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">商品登録の流れ</h2>
            <p className="mt-1 text-xs text-muted">商品情報を確認・編集し、お客様表示で登録内容を確認します。</p>
          </div>
          <p className="text-xs font-semibold text-brown">現在：STEP {step === 'preview' ? 2 : 1}</p>
        </div>
        <nav className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="商品登録ステップ">
          <Link
            href={stepHref('info')}
            aria-current={step === 'info' ? 'step' : undefined}
            className={`block min-h-24 rounded-xl border px-3 py-3 transition ${
              step === 'info'
                ? 'border-brown bg-ivory/80 ring-1 ring-brown/20'
                : 'border-line bg-white hover:border-brown hover:bg-ivory/30'
            }`}
          >
            <span className="text-xs font-semibold text-brown">STEP 1</span>
            <span className="mt-1 block text-sm font-semibold">商品情報</span>
            <span className="mt-1 block text-[0.7rem] leading-5 text-muted">商品・資料・選択項目・価格を設定</span>
          </Link>
          <Link
            href={stepHref('preview')}
            aria-current={step === 'preview' ? 'step' : undefined}
            className={`block min-h-24 rounded-xl border px-3 py-3 transition ${
              step === 'preview'
                ? 'border-brown bg-ivory/80 ring-1 ring-brown/20'
                : 'border-line bg-white hover:border-brown hover:bg-ivory/30'
            }`}
          >
            <span className="text-xs font-semibold text-brown">STEP 2</span>
            <span className="mt-1 block text-sm font-semibold">内容確認・登録</span>
            <span className="mt-1 block text-[0.7rem] leading-5 text-muted">お客様画面での見え方を最終確認</span>
          </Link>
        </nav>
      </section>

      {step === 'info' && (canEditThisOption ? (
        <section className="space-y-6" data-testid="option-registration-info">
          <div>
            <h2 className="text-xl font-semibold">STEP 1 商品情報</h2>
            <p className="mt-1 text-sm text-muted">
              商品情報、画像・メーカー資料、お客様が選ぶ色・仕様、商品価格と公開設定をこの画面でまとめて設定します。
            </p>
          </div>

          <OptionForm
            mode="product"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />

          <OptionMediaManager option={option} />

          {catalogEditor && <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />}

          <OptionForm
            mode="pricing"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />

          {catalogEditor && <OptionVariantPricing option={option} groups={variants.groups} choices={variants.choices} />}
        </section>
      ) : <section className="card p-5 text-sm text-muted">この商品は閲覧専用です。代理店が編集できるのは、自社で登録したフリー商品のみです。</section>)}
      {step === 'preview' && (
        <section className="space-y-5" data-testid="option-customer-preview">
          <div>
            <h2 className="text-xl font-semibold">STEP 2 内容確認・登録</h2>
            <p className="mt-1 text-sm text-muted">シミュレーターの商品詳細でお客様に伝わる内容を、登録済みデータで確認します。</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <div className="card space-y-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">商品画像</h3>
                {option.manufacturer_document_url && (
                  <a
                    href={option.manufacturer_document_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-brown underline underline-offset-4"
                  >
                    メーカー資料を見る
                  </a>
                )}
              </div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-sand/40">
                {option.image_url ? (
                  <SmartImage src={option.image_url} alt={option.name} fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted">メイン画像未登録</div>
                )}
              </div>
              {!!option.gallery_images?.length && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {option.gallery_images.slice(0, 8).map((image) => (
                    <div key={image.id} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-white">
                      <SmartImage src={image.url} alt={image.alt || option.name} fill sizes="160px" className="object-contain" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card space-y-5 p-5 sm:p-6">
              <div>
                <p className="text-xs text-muted">{[option.manufacturer, option.model_no].filter(Boolean).join(' ／ ')}</p>
                <h3 className="mt-1 text-2xl font-semibold">{option.name}</h3>
                {option.size_note && <p className="mt-2 text-sm text-ink-soft">{option.size_note}</p>}
              </div>

              {option.highlight && (
                <div className="rounded-lg bg-ivory px-3 py-2 text-sm font-semibold text-ink-soft">{option.highlight}</div>
              )}

              {option.description && <p className="whitespace-pre-wrap text-sm leading-7 text-ink-soft">{option.description}</p>}

              <div className="rounded-xl border border-line bg-white p-4">
                <p className="text-xs text-muted">商品価格（税別）</p>
                <p className="mt-1 text-lg font-semibold">
                  {option.price_on_request ? '別途見積' : formatYen(option.price)}
                </p>
              </div>

              <div className="space-y-4">
                {customerRows.map(({ group, choices }) => (
                  <div key={group.id}>
                    <p className="text-sm font-semibold">{group.name}</p>
                    {group.note && <p className="mt-1 text-xs text-muted">{group.note}</p>}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {choices.map((choice) => (
                        <div key={choice.id} className="overflow-hidden rounded-lg border border-line bg-white">
                          {choice.image_url ? (
                            <div className="relative aspect-[5/3] bg-sand/30">
                              <SmartImage src={choice.image_url} alt={choice.name} fill sizes="180px" className="object-contain" />
                            </div>
                          ) : (
                            <div className="flex min-h-20 items-center justify-center bg-ivory/40 px-3 text-center text-sm font-semibold">
                              {choice.name}
                            </div>
                          )}
                          <div className="px-3 py-2">
                            {choice.image_url && <p className="text-sm font-semibold">{choice.name}</p>}
                            <p className="mt-1 text-xs text-muted">
                              {choice.price_on_request
                                ? '別途見積'
                                : choice.extra_price > 0
                                  ? `+${formatYen(choice.extra_price)}`
                                  : '追加なし'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" className="btn-primary w-full" disabled>
                この内容に変更する（プレビュー）
              </button>
            </div>
          </div>
        </section>
      )}
    </AdminPage>
  );
}
