import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteOptionAction, publishOptionAction } from '@/lib/actions/admin';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getOptionHqStandardCostAccess } from '@/lib/data/option-hq-standard-cost';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, LEGACY_FIRE_SPEC_CATEGORY_CODE, type OptionConflict, type OptionDependency } from '@/lib/domain/types';
import { productRegistrationCategoryDisplay } from '@/lib/domain/product-registration-category-display';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { Alert } from '@/components/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { OptionCustomerPreview } from '@/components/admin/option-customer-preview';
import { OptionHqStandardCostCard } from '@/components/admin/option-hq-standard-cost-card';
import { OptionMediaManager } from '@/components/admin/option-media-manager';
import { OptionVariantManager } from '@/components/admin/option-variant-manager';
import { RegisteredOptionEditFlow } from '@/components/admin/registered-option-edit-flow';
import {
  ProductPriceUnitPublishedCard,
  ProductPriceUnitRegistrationField,
  ProductPriceUnitRouteSummary,
} from '@/components/admin/product-price-unit';
import { requiresZeroPriceConfirmation } from '@/lib/domain/product-publication';
import { sekinoRegistrationWarnings } from '@/lib/domain/sekino-registration-check';
import { findProductDuplicateCandidates } from '@/lib/domain/product-ledger';
import {
  OptionRegistrationPreviewButton,
  OptionRegistrationSaveBoundary,
} from '@/components/admin/option-registration-save-boundary';

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
  const returnToLedger = returnTo?.startsWith('/admin/ledger') ?? false;
  const returnLabel = returnToLedger ? '商品台帳へ戻る' : returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る';

  const [categories, models, options, variants, hqCostAccess] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.getOptionVariants(id),
    getOptionHqStandardCostAccess(id),
  ]);
  const category = categories.find((row) => row.id === option.category_id);
  const registrationCategories = category?.code === LEGACY_FIRE_SPEC_CATEGORY_CODE
    ? categories.filter((row) => row.code === LEGACY_FIRE_SPEC_CATEGORY_CODE)
    : category?.code === FREE_PRODUCT_CATEGORY_CODE
      ? categories.filter((row) => row.code === FREE_PRODUCT_CATEGORY_CODE)
      : categories.filter(
          (row) => row.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE && row.code !== FREE_PRODUCT_CATEGORY_CODE
        );
  const registrationDisplayCategories = productRegistrationCategoryDisplay(registrationCategories);
  const canEditThisOption = canEditCatalog(actor.role) || (category?.code === FREE_PRODUCT_CATEGORY_CODE && option.owner_id === actor.id);
  const catalogEditor = canEditCatalog(actor.role);
  const needsZeroPriceConfirmation = requiresZeroPriceConfirmation(option);
  const duplicateCandidates = findProductDuplicateCandidates(options, {
    categoryId: option.category_id,
    manufacturer: option.manufacturer ?? '',
    name: option.name,
    modelNo: option.model_no ?? '',
    excludeId: option.id,
  });
  const incompleteVisibleGroups = variants.groups.filter((group) => {
    if (group.status !== 'published') return false;
    return !variants.choices.some((choice) => choice.group_id === group.id && choice.status === 'published');
  });
  const registrationBlockingIssues = [
    ...(!option.image_url ? ['メイン画像を登録してください'] : []),
  ];
  const sekinoWarnings = sekinoRegistrationWarnings(option, variants.groups, variants.choices);
  const registrationWarnings = [
    ...(duplicateCandidates.length > 0 ? ['既存商品に重複候補があります'] : []),
    ...(!option.manufacturer_document_url ? ['メーカー資料PDFが未登録です（原則登録）'] : []),
    ...(!option.price_on_request && option.price === 0 ? ['商品価格が0円です。正式な0円の場合はSTEP 2で確認が必要です'] : []),
    ...incompleteVisibleGroups.map((group) => `「${group.name}」にお客様へ表示する選択肢がありません`),
  ];

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

  if (option.status === 'published') {
    return (
      <AdminPage title={option.name} lead={option.product_no ?? '商品管理番号はDB反映後に表示'}>
        <BackLink href={returnTo ?? (category?.code === FREE_PRODUCT_CATEGORY_CODE ? '/admin/free-products' : '/admin/options')} label={returnLabel} />
        <FlashMessages sp={sp} />
        {sp.published && <Alert tone="success">商品を登録しました。</Alert>}
        {canEditThisOption ? (
          <RegisteredOptionEditFlow
            key={option.updated_at}
            option={option}
            categories={registrationDisplayCategories}
            models={models}
            dependencies={deps}
            conflicts={confs}
            variantGroups={variants.groups}
            variantChoices={variants.choices}
            returnTo={returnTo}
            duplicateCandidates={catalogEditor ? duplicateCandidates.slice(0, 3).map(({ option: candidate, reason }) => ({
              id: candidate.id,
              name: candidate.name,
              productNo: candidate.product_no ?? null,
              reason,
              modelNo: candidate.model_no,
              manufacturer: candidate.manufacturer,
            })) : undefined}
            financialTools={
              <>
                <ProductPriceUnitPublishedCard optionId={id} />
                {hqCostAccess.available && hqCostAccess.canView && (
                  <OptionHqStandardCostCard
                    optionId={id}
                    canManage={hqCostAccess.canManage}
                    cost={hqCostAccess.cost}
                  />
                )}
              </>
            }
          />
        ) : (
          <>
            {hqCostAccess.available && hqCostAccess.canView && (
              <OptionHqStandardCostCard
                optionId={id}
                canManage={hqCostAccess.canManage}
                cost={hqCostAccess.cost}
              />
            )}
            <ProductPriceUnitPublishedCard optionId={id} />
            <section className="card p-5 text-sm text-muted">この商品は閲覧専用です。代理店が編集できるのは、自社で登録したフリー商品のみです。</section>
          </>
        )}
      </AdminPage>
    );
  }

  const stepHref = (key: RegistrationStep) => {
    const params = new URLSearchParams({ step: key });
    if (returnTo) params.set('return_to', returnTo);
    return `?${params.toString()}`;
  };

  return (
    <AdminPage
      title="商品を追加"
      lead={`下書き：${option.name} ／ ${option.product_no ?? '商品管理番号はDB反映後に表示'}`}
    >
      <OptionRegistrationSaveBoundary>
        <BackLink href={returnTo ?? (category?.code === FREE_PRODUCT_CATEGORY_CODE ? '/admin/free-products' : '/admin/options')} label={returnLabel} />
        <FlashMessages sp={sp} />

        <section className="card p-4 sm:p-5" aria-label="商品登録の2ステップ">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">商品登録の流れ</h2>
              <p className="mt-1 text-xs text-muted">STEP 1で商品情報を入力し、STEP 2でお客様表示を確認して登録します。</p>
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
            {step === 'info' && canEditThisOption ? (
              <OptionRegistrationPreviewButton
                href={stepHref('preview')}
                className="block min-h-24 rounded-xl border border-line bg-white px-3 py-3 text-left transition hover:border-brown hover:bg-ivory/30"
              >
                <span className="text-xs font-semibold text-brown">STEP 2</span>
                <span className="mt-1 block text-sm font-semibold">登録内容確認</span>
                <span className="mt-1 block text-[0.7rem] leading-5 text-muted">シミュレーターと同じ商品詳細で確認</span>
              </OptionRegistrationPreviewButton>
            ) : (
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
            )}
          </nav>
        </section>

        {step === 'info' && (canEditThisOption ? (
          <section className="space-y-6" data-testid="option-registration-info">
            <div>
              <h2 className="text-xl font-semibold">STEP 1 商品情報</h2>
              <p className="mt-1 text-sm text-muted">
                上から順に入力してください。変更内容は、STEP 2へ進むときや画像・資料を登録する前に自動保存されます。
              </p>
            </div>

            <div className="registration-step1-sections flex flex-col gap-6">
              <style>{`
                .registration-step1-sections > form#option-main-form { display: contents; }
                .registration-step1-sections #product-identify { order: 10; }
                .registration-step1-sections #product-details { order: 20; }
                .registration-step1-sections #product-main-media { order: 30; }
                .registration-step1-sections #sales-settings { order: 50; }
              `}</style>

              <OptionForm
                mode="all"
                option={option}
                categories={registrationDisplayCategories}
                models={models}
                allOptions={options}
                dependencies={deps}
                conflicts={confs}
                returnTo={returnTo}
              />

              <ProductPriceUnitRegistrationField optionId={id} />

              {sp.created && (
                <div id="basic-info-saved" className="w-full" style={{ order: 15 }}>
                  <Alert tone="success">✓ 1. 基本情報を保存しました。</Alert>
                </div>
              )}

              <div style={{ order: 35 }}>
                <OptionMediaManager option={option} />
              </div>

              {catalogEditor && (
                <div className="registration-customer-selection" style={{ order: 40 }}>
                  <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />
                </div>
              )}

              {hqCostAccess.available && hqCostAccess.canView && (
                <div style={{ order: 55 }} data-testid="option-registration-hq-cost">
                  <OptionHqStandardCostCard
                    optionId={id}
                    canManage={hqCostAccess.canManage}
                    cost={hqCostAccess.cost}
                  />
                </div>
              )}

              <section className="card space-y-4 p-4 sm:p-5" data-testid="option-registration-check" style={{ order: 60 }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">7. 登録前チェック</h3>
                    <p className="mt-1 text-xs text-muted">公開に必要な項目と、公開前に確認してほしい項目を分けて表示します。</p>
                  </div>
                  <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                    registrationBlockingIssues.length > 0
                      ? 'bg-[#fdecec] text-[#8b2e2e]'
                      : registrationWarnings.length > 0
                        ? 'bg-[#fff1cf] text-[#7c5a18]'
                        : 'bg-[#eaf6f1] text-[#245a48]'
                  }`}>
                    {registrationBlockingIssues.length > 0
                      ? `公開に必要：${registrationBlockingIssues.length}件`
                      : registrationWarnings.length > 0
                        ? `確認：${registrationWarnings.length}件`
                        : '基本チェックOK'}
                  </span>
                </div>

                {registrationBlockingIssues.length > 0 && (
                  <div className="rounded-xl border border-[#e7b9b9] bg-[#fff4f4] px-4 py-3 text-xs leading-5 text-ink-soft">
                    <p className="font-semibold text-[#8b2e2e]">公開に必要</p>
                    <ul className="mt-1 space-y-1">
                      {registrationBlockingIssues.map((issue) => <li key={issue}>・{issue}</li>)}
                    </ul>
                  </div>
                )}

                {registrationWarnings.length > 0 && (
                  <div className="rounded-xl border border-[#ead6a7] bg-[#fff8e8] px-4 py-3 text-xs leading-5 text-ink-soft">
                    <p className="font-semibold text-[#7c5a18]">確認してください</p>
                    <ul className="mt-1 space-y-1">
                      {registrationWarnings.map((issue) => <li key={issue}>・{issue}</li>)}
                    </ul>
                  </div>
                )}

                {registrationBlockingIssues.length === 0 && registrationWarnings.length === 0 && (
                  <p className="rounded-xl border border-line bg-ivory/30 px-4 py-3 text-xs leading-5 text-muted">
                    現在の保存内容に、公開前の要確認事項はありません。
                  </p>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted">STEP 2では、シミュレーターと同じ商品詳細画面で最終表示を確認します。</p>
                  <OptionRegistrationPreviewButton href={stepHref('preview')} className="btn-primary shrink-0">
                    STEP 2 登録内容確認へ
                  </OptionRegistrationPreviewButton>
                </div>
              </section>

              {catalogEditor && (
                <details className="rounded-xl border border-line bg-white" style={{ order: 70 }}>
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">その他の操作</summary>
                  <div className="border-t border-line px-4 py-4">
                    <p className="mb-3 text-xs text-muted">下書き商品は削除できます。保存済みの仕様で使用中の場合は削除できません。</p>
                    <form action={deleteOptionAction} data-skip-option-autosave="true">
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
            </div>
          </section>
        ) : <section className="card p-5 text-sm text-muted">この商品は閲覧専用です。代理店が編集できるのは、自社で登録したフリー商品のみです。</section>)}

        {step === 'preview' && (
          <section className="space-y-5" data-testid="option-customer-preview">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">STEP 2 登録内容確認</h2>
                <p className="mt-1 text-sm text-muted">実際のシミュレーターの商品詳細表示と同じ本文・レイアウトで、登録する内容を確認します。</p>
              </div>
              {canEditThisOption && <Link href={stepHref('info')} className="btn-secondary btn-sm">商品情報に戻る</Link>}
            </div>

            <div className="rounded-xl border border-brown/20 bg-ivory/70 px-3 py-2 text-xs text-ink-soft">
              この画面での仕様選択は表示確認用です。下書きの登録内容は変更されません。
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

            {option.manufacturer?.includes('セキノ興産') && (
              <section
                data-testid="sekino-step2-color-code-check"
                className="rounded-xl border border-[#ead6a7] bg-[#fff8e8] px-4 py-3 text-xs leading-5 text-ink-soft"
              >
                <h3 className="font-semibold text-[#7c5a18]">セキノ興産：メーカー表示条件の確認</h3>
                <p className="mt-1">
                  メーカー名・製品名・品番（色番号等）の表示が必要です。
                  カラーの品番はメーカー資料と照合してください。
                </p>
                {sekinoWarnings.length > 0 ? (
                  <ul className="mt-2 space-y-1" data-testid="sekino-step2-warnings">
                    {sekinoWarnings.map((warning, index) => <li key={index}>・{warning}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2" data-testid="sekino-step2-manual-review">
                    記載漏れの候補は検出されませんでした。品番の正確さは担当者が最終確認してください。
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted">
                  文字列からの簡易チェックです。色番号が数字のみの場合などは注意が出る場合があります。公開を自動停止しません。
                </p>
              </section>
            )}

            <ProductPriceUnitRouteSummary />

            <section className="card space-y-4 p-4 sm:p-5" aria-label="商品登録" data-testid="step2-publish-panel">
              <div>
                <h3 className="font-semibold">登録状態</h3>
                <p className="mt-1 text-sm text-muted">現在は下書きです。上の登録内容とお客様表示に問題がなければ登録してください。</p>
              </div>
              {canEditThisOption && category && (
                <form action={publishOptionAction} className="w-full space-y-3">
                  <input type="hidden" name="id" value={option.id} />
                  {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
                  {needsZeroPriceConfirmation && (
                    <div className="max-w-xl rounded-xl border border-[#d9a441] bg-[#fff8e8] p-3 text-sm">
                      <p className="font-semibold text-ink">商品価格が0円です</p>
                      <p className="mt-1 text-xs leading-5 text-ink-soft">
                        価格未確認の場合は登録せず、商品情報に戻って価格を確定してください。
                        正式な0円商品として登録する場合だけ、次の確認欄にチェックしてください。
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
                  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3" data-testid="step2-publish-actions">
                    <Link href={stepHref('info')} className="btn-secondary btn-sm shrink-0 whitespace-nowrap">
                      STEP1に戻る
                    </Link>
                    <ConfirmSubmit
                      message={
                        needsZeroPriceConfirmation
                          ? `「${option.name}」を商品価格0円で登録しますか？`
                          : `「${option.name}」をこの内容で登録しますか？`
                      }
                      className="btn-primary btn-sm shrink-0 whitespace-nowrap"
                    >
                      この内容で登録
                    </ConfirmSubmit>
                  </div>
                </form>
              )}
            </section>
          </section>
        )}
      </OptionRegistrationSaveBoundary>
    </AdminPage>
  );
}
