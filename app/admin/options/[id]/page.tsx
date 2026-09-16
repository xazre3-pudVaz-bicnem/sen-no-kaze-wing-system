import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteOptionAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionConflict, OptionDependency, OptionVariantChoice, OptionVariantGroup } from '@/lib/domain/types';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { OptionMediaManager } from '@/components/admin/option-media-manager';
import { OptionVariantManager, OptionVariantPricing } from '@/components/admin/option-variant-manager';
import { SmartImage } from '@/components/ui/smart-image';

type RegistrationStep = 'identify' | 'details' | 'media' | 'choices' | 'pricing' | 'order' | 'preview';

const STEPS: { key: RegistrationStep; no: number; label: string; note: string }[] = [
  { key: 'identify', no: 1, label: '商品特定', note: 'カテゴリー・メーカー・商品名・型番' },
  { key: 'details', no: 2, label: '商品の詳細', note: 'サイズ・説明・特徴' },
  { key: 'media', no: 3, label: 'お客様資料', note: 'メイン画像・サブ画像・メーカーPDF' },
  { key: 'choices', no: 4, label: 'お客様選択', note: '色・柄・仕様・文字カード' },
  { key: 'pricing', no: 5, label: '価格設定', note: '基本・色仕様ごとの追加金額' },
  { key: 'order', no: 6, label: '発注内容確認', note: '発注時に引き継ぐ項目' },
  { key: 'preview', no: 7, label: 'お客様画面最終確認', note: 'シミュレーター表示の確認' },
];

function validStep(value: string | undefined): value is RegistrationStep {
  return STEPS.some((step) => step.key === value);
}

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
  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) notFound();

  const legacyStep: RegistrationStep =
    sp.tab === 'customer' ? 'choices' : sp.tab === 'sales' ? 'pricing' : 'identify';
  const step: RegistrationStep = validStep(sp.step) ? sp.step : legacyStep;
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

  const category = categories.find((row) => row.id === option.category_id);
  const model = models.find((row) => row.id === option.base_model_id);
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
      actions={
        <form action={deleteOptionAction}>
          <input type="hidden" name="id" value={option.id} />
          <ConfirmSubmit
            message={`「${option.name}」を削除しますか？保存済みの仕様で使用中の場合は削除できません。`}
            className="btn-ghost btn-sm text-danger"
          >
            削除
          </ConfirmSubmit>
        </form>
      }
    >
      <BackLink href={returnTo ?? '/admin/options'} label={returnTo ? '見積テンプレートへ戻る' : '一覧へ戻る'} />
      <FlashMessages sp={sp} />

      <section className="card p-4 sm:p-5" aria-label="商品登録の7ステップ">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">商品登録の流れ</h2>
            <p className="mt-1 text-xs text-muted">既存の商品情報を使いながら、1〜7の順に確認できます。必要なSTEPだけ後から修正しても構いません。</p>
          </div>
          <p className="text-xs font-semibold text-brown">現在：STEP {STEPS.find((row) => row.key === step)?.no}</p>
        </div>
        <nav className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="商品登録ステップ">
          {STEPS.map((item) => {
            const active = step === item.key;
            return (
              <Link
                key={item.key}
                href={stepHref(item.key)}
                aria-current={active ? 'step' : undefined}
                className={`block min-h-24 rounded-xl border px-3 py-3 transition ${
                  active
                    ? 'border-brown bg-ivory/80 ring-1 ring-brown/20'
                    : 'border-line bg-white hover:border-brown hover:bg-ivory/30'
                }`}
              >
                <span className="text-xs font-semibold text-brown">STEP {item.no}</span>
                <span className="mt-1 block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-[0.7rem] leading-5 text-muted">{item.note}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      {step === 'identify' && (
        <OptionForm
          mode="identify"
          option={option}
          categories={categories}
          models={models}
          allOptions={options}
          dependencies={deps}
          conflicts={confs}
        />
      )}

      {step === 'details' && (
        <OptionForm
          mode="details"
          option={option}
          categories={categories}
          models={models}
          allOptions={options}
          dependencies={deps}
          conflicts={confs}
        />
      )}

      {step === 'media' && (
        <>
          <OptionForm
            mode="media"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />
          <OptionMediaManager option={option} />
        </>
      )}

      {step === 'choices' && (
        <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />
      )}

      {step === 'pricing' && (
        <>
          <OptionForm
            mode="pricing"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />
          <OptionVariantPricing option={option} groups={variants.groups} choices={variants.choices} />
        </>
      )}

      {step === 'order' && (
        <section className="card space-y-6 p-5 sm:p-6" data-testid="option-order-preview">
          <div>
            <h2 className="text-xl font-semibold">STEP 6 発注内容確認</h2>
            <p className="mt-1 text-sm text-muted">
              発注時に必要になる情報を、現在の商品マスターから確認します。実際の選択色・仕様と数量は、お客様の見積・発注内容から引き継ぎます。
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[42rem] text-sm">
              <tbody className="divide-y divide-line">
                {[
                  ['メーカー', option.manufacturer || '未入力'],
                  ['商品名', option.name],
                  ['シリーズ・型番', option.model_no || '未入力'],
                  ['サイズ', option.size_note || '未入力'],
                  ['数量', '1（見積・発注時に確定）'],
                  ['対象商品モデル', model?.name ?? '全モデル共通'],
                  ['カテゴリー', category?.name ?? '未設定'],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th className="w-44 bg-ivory/60 px-4 py-3 text-left font-semibold">{label}</th>
                    <td className="px-4 py-3">{value}</td>
                  </tr>
                ))}
                {customerRows.map(({ group, choices }) => (
                  <tr key={group.id}>
                    <th className="w-44 bg-ivory/60 px-4 py-3 text-left font-semibold">{group.name}</th>
                    <td className="px-4 py-3">
                      <span className="font-semibold">お客様選択から引き継ぎ</span>
                      <span className="ml-2 text-xs text-muted">
                        候補：{choices.length ? choices.map((choice) => choice.name).join(' ／ ') : '未登録'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted">
            固定構成・標準装備はメーカーPDFで足りるものを重複登録せず、発注で必要な選択項目だけを商品マスターに持たせる運用です。
          </p>
        </section>
      )}

      {step === 'preview' && (
        <section className="space-y-5" data-testid="option-customer-preview">
          <div>
            <h2 className="text-xl font-semibold">STEP 7 お客様画面最終確認</h2>
            <p className="mt-1 text-sm text-muted">シミュレーターの商品詳細でお客様に伝わる内容を、登録済みデータだけで最終確認します。</p>
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
                <p className="text-xs text-muted">追加金額</p>
                <p className="mt-1 text-lg font-semibold">
                  {option.price_on_request ? '別途見積' : option.price > 0 ? `+${formatYen(option.price)}` : '追加なし'}
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
