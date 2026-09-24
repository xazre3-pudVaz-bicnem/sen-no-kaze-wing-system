import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteOptionAction, publishOptionAction } from '@/lib/actions/admin';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, type OptionConflict, type OptionDependency } from '@/lib/domain/types';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { OptionCustomerPreview } from '@/components/admin/option-customer-preview';
import { OptionMediaManager } from '@/components/admin/option-media-manager';
import { OptionVariantManager, OptionVariantPricing } from '@/components/admin/option-variant-manager';
import { requiresZeroPriceConfirmation } from '@/lib/domain/product-publication';

type RegistrationStep = 'info' | 'preview';

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
  const needsZeroPriceConfirmation = requiresZeroPriceConfirmation(option);

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

  const stepHref = (key: RegistrationStep) => {
    const params = new URLSearchParams({ step: key });
    if (returnTo) params.set('return_to', returnTo);
    return `?${params.toString()}`;
  };

  return (
    <AdminPage title={option.name} lead={option.product_no ?? '商品管理番号はDB反映後に表示'}>
      <BackLink href={returnTo ?? (category?.code === FREE_PRODUCT_CATEGORY_CODE ? '/admin/free-products' : '/admin/options')} label={returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る'} />
      <FlashMessages sp={sp} />

      <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">商品登録の流れ</h2>
            <p className="mt-1 text-xs text-muted">STEP 1で必要な情報を保存し、STEP 2で実際のお客様表示を確認します。</p>
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
            <span className="mt-1 block text-[0.7rem] leading-5 text-muted">基本情報・画像・資料・お客様選択・価格を設定</span>
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
            <span className="mt-1 block text-sm font-semibold">登録内容確認</span>
            <span className="mt-1 block text-[0.7rem] leading-5 text-muted">シミュレーターと同じ商品詳細で確認</span>
          </Link>
        </nav>
      </section>

      {step === 'info' && (canEditThisOption ? (
        <section className="space-y-6" data-testid="option-registration-info">
          <div>
            <h2 className="text-xl font-semibold">STEP 1 商品情報</h2>
            <p className="mt-1 text-sm text-muted">
              上から順に登録してください。基本情報・メイン画像・価格公開は1つの保存ボタンで保存し、サブ画像や選択肢は必要な項目だけ個別に保存します。
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3" aria-label="商品情報の入力順">
            {[
              ['1', '商品本体', '基本情報・詳細・メイン画像・価格公開'],
              ['2', 'お客様資料', 'サブ画像・メーカー資料'],
              ['3', 'お客様選択', '色・柄・仕様と追加金額'],
            ].map(([no, label, note]) => (
              <div key={no} className="rounded-xl border border-line bg-white px-4 py-3">
                <p className="text-xs font-semibold text-brown">入力 {no}</p>
                <p className="mt-1 text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{note}</p>
              </div>
            ))}
          </div>

          <OptionForm
            mode="all"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />

          <OptionMediaManager option={option} />

          {catalogEditor && <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />}

          {catalogEditor && <OptionVariantPricing option={option} groups={variants.groups} choices={variants.choices} />}

          <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h3 className="font-semibold">登録内容を確認</h3>
              <p className="mt-1 text-xs text-muted">保存した内容を、シミュレーターと同じ商品詳細画面で確認します。</p>
            </div>
            <Link href={stepHref('preview')} className="btn-primary shrink-0">STEP 2 登録内容確認へ</Link>
          </section>

          {catalogEditor && (
            <details className="rounded-xl border border-line bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">その他の操作</summary>
              <div className="border-t border-line px-4 py-4">
                <p className="mb-3 text-xs text-muted">削除は通常の編集では使用しません。保存済みの仕様で使用中の商品は削除できません。</p>
                <form action={deleteOptionAction}>
                  <input type="hidden" name="id" value={option.id} />
                  <ConfirmSubmit
                    message={`「${option.name}」を削除しますか？保存済みの仕様で使用中の場合は削除できません。`}
                    className="btn-ghost btn-sm text-danger"
                  >
                    商品を削除
                  </ConfirmSubmit>
                </form>
              </div>
            </details>
          )}
        </section>
      ) : <section className="card p-5 text-sm text-muted">この商品は閲覧専用です。代理店が編集できるのは、自社で登録したフリー商品のみです。</section>)}

      {step === 'preview' && (
        <section className="space-y-5" data-testid="option-customer-preview">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">STEP 2 登録内容確認</h2>
              <p className="mt-1 text-sm text-muted">実際のシミュレーターの商品詳細表示と同じ本文・レイアウトで、登録済みデータを確認します。</p>
            </div>
            {canEditThisOption && <Link href={stepHref('info')} className="btn-secondary btn-sm">商品情報に戻る</Link>}
          </div>

          <div className="rounded-xl border border-brown/20 bg-ivory/70 px-3 py-2 text-xs text-ink-soft">
            この画面での仕様選択は表示確認用です。商品マスターの登録内容は変更されません。
          </div>

          {category ? (
            <OptionCustomerPreview
              key={option.id}
              category={category}
              option={option}
              groups={variants.groups}
              choices={variants.choices}
            />
          ) : (
            <div className="card p-5 text-sm text-danger">商品カテゴリーが見つからないため、お客様表示を確認できません。</div>
          )}

          <section className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-label="商品公開">
            <div>
              <h3 className="font-semibold">公開状態</h3>
              {option.status === 'published' ? (
                <p className="mt-1 text-sm text-muted">公開中です。お客様のシミュレーターに表示される設定になっています。</p>
              ) : (
                <p className="mt-1 text-sm text-muted">現在は下書きです。上のお客様表示に問題がなければ公開してください。</p>
              )}
            </div>
            {canEditThisOption && option.status === 'draft' && category && (
              <form action={publishOptionAction} className="space-y-3">
                <input type="hidden" name="id" value={option.id} />
                {needsZeroPriceConfirmation && (
                  <div className="max-w-xl rounded-xl border border-[#d9a441] bg-[#fff8e8] p-3 text-sm">
                    <p className="font-semibold text-ink">商品価格が0円です</p>
                    <p className="mt-1 text-xs leading-5 text-ink-soft">
                      価格未確認の場合は公開せず、商品情報に戻って価格を確定してください。
                      正式な0円商品として公開する場合だけ、次の確認欄にチェックしてください。
                    </p>
                    <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-ink">
                      <input
                        type="checkbox"
                        name="confirm_zero_price"
                        className="mt-0.5 h-4 w-4 rounded border-line"
                        required
                      />
                      商品価格0円が正式な登録値であることを確認しました
                    </label>
                  </div>
                )}
                <ConfirmSubmit
                  message={
                    needsZeroPriceConfirmation
                      ? `「${option.name}」を商品価格0円でお客様向けに公開しますか？`
                      : `「${option.name}」をお客様向けに公開しますか？`
                  }
                  className="btn-primary"
                >
                  この内容で公開
                </ConfirmSubmit>
              </form>
            )}
            {option.status === 'published' && (
              <span className="inline-flex w-fit rounded-full bg-[#eaf6f1] px-3 py-1 text-xs font-semibold text-[#245a48]">公開中</span>
            )}
          </section>
        </section>
      )}
    </AdminPage>
  );
}
