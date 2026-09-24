import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { simulatorEstimateChoices } from '@/lib/domain/estimate-template';
import { formatYen } from '@/lib/domain/pricing';
import type { EstimateTemplateBundle } from '@/lib/domain/types';
import { Badge, Input } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { StandardEstimateSimulatorPreview } from '@/components/admin/standard-estimate-simulator-preview';

function filterHref(model: string, q: string) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/admin/estimate-templates?${query}` : '/admin/estimate-templates';
}

function selectionHref(
  model: string,
  q: string,
  selectedModel: string,
  selectedSpec: string
) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (q) params.set('q', q);
  params.set('selected_model', selectedModel);
  params.set('selected_spec', selectedSpec);
  return `/admin/estimate-templates?${params.toString()}#estimate-preview`;
}

function sampleHref(model: string, q: string) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (q) params.set('q', q);
  params.set('sample', '1');
  return `/admin/estimate-templates?${params.toString()}#estimate-preview`;
}

const LIST_GRID =
  'grid grid-cols-[minmax(10rem,2fr)_6rem_7rem_5rem_6.5rem] items-center';

const SAMPLE_PRICING = {
  costTaxIncluded: 2_100_000,
  saleTaxIncluded: 2_822_600,
  marginRate: '25.6%',
} as const;

export default async function EstimateTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireCatalogEditor('/admin/estimate-templates');
  const sp = await searchParams;
  const store = await getStore();
  const [models, templateHeaders] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
  ]);

  const templateBundles = (
    await Promise.all(
      templateHeaders.map((template) =>
        store.getEstimateTemplateBundle(template.base_model_id, template.spec_code)
      )
    )
  ).filter((row): row is EstimateTemplateBundle => Boolean(row));

  const bundlesByModel = new Map<string, EstimateTemplateBundle[]>();
  for (const bundle of templateBundles) {
    const rows = bundlesByModel.get(bundle.template.base_model_id) ?? [];
    rows.push(bundle);
    bundlesByModel.set(bundle.template.base_model_id, rows);
  }

  const simulatorModels = models.filter((model) => model.status === 'published');
  const modelId = sp.model ?? '';
  const qRaw = (sp.q ?? '').trim();
  const q = qRaw.toLowerCase();
  const hasFilters = Boolean(modelId || q);

  const groups = simulatorModels
    .filter((model) => !modelId || model.id === modelId)
    .map((model) => {
      const choices = simulatorEstimateChoices(model, bundlesByModel.get(model.id) ?? [])
        .filter((choice) => {
          if (!q) return true;
          return [model.name, choice.name, choice.code, choice.description]
            .join(' ')
            .toLowerCase()
            .includes(q);
        });

      return { model, choices };
    })
    .filter((group) => group.choices.length > 0);

  const sampleSelected = sp.sample === '1';
  const sampleModel = simulatorModels.find((model) => model.slug === 'wing-01') ?? null;
  const sampleSpecCode = sampleModel?.presets.some((preset) => preset.code === 'hotel') ? 'hotel' : null;

  const requestedModelId = sp.selected_model ?? '';
  const requestedSpecCode = sp.selected_spec ?? '';
  const requestedSelection = groups
    .flatMap((group) =>
      group.choices.map((choice) => ({ model: group.model, choice }))
    )
    .find(
      ({ model, choice }) =>
        model.id === requestedModelId && choice.code === requestedSpecCode
    );
  const firstSelection =
    groups[0]?.choices[0] ? { model: groups[0].model, choice: groups[0].choices[0] } : null;
  const selected = sampleSelected ? null : requestedSelection ?? firstSelection;
  const [selectedCatalog, sampleCatalog] = await Promise.all([
    selected ? store.getCatalogBundle(selected.model.id) : Promise.resolve(null),
    sampleSelected && sampleModel && sampleSpecCode
      ? store.getCatalogBundle(sampleModel.id)
      : Promise.resolve(null),
  ]);

  const totalChoices = groups.reduce((sum, group) => sum + group.choices.length, 0);

  return (
    <AdminPage
      title="標準見積"
      lead="標準見積を一覧で確認・管理します。"
      actions={
        <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
          ＋ 新規標準見積を作成
        </Link>
      }
    >
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold">標準見積一覧</h2>
          <span className="text-xs text-muted">{totalChoices}件 + 動作確認サンプル1件</span>
        </div>

        <div className="border-b border-line bg-sand/20 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-5">
            <div className="shrink-0">
              <p className="mb-1.5 text-xs font-semibold text-ink-soft">商品モデル</p>
              <div className="flex flex-wrap items-center gap-1.5" aria-label="商品モデル">
                <Link
                  href={filterHref('', qRaw)}
                  aria-current={!modelId ? 'page' : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    !modelId
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-white text-ink hover:bg-sand'
                  }`}
                >
                  すべて
                </Link>
                {simulatorModels.map((model) => {
                  const active = model.id === modelId;
                  return (
                    <Link
                      key={model.id}
                      href={filterHref(model.id, qRaw)}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? 'border-forest bg-forest text-white'
                          : 'border-line bg-white text-ink hover:bg-sand'
                      }`}
                    >
                      {model.name === 'フラット' ? 'Flat' : model.name}
                    </Link>
                  );
                })}
              </div>
            </div>

            <form method="get" className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end lg:justify-end">
              {modelId && <input type="hidden" name="model" value={modelId} />}
              <label className="block min-w-0 flex-1 lg:max-w-xl">
                <span className="mb-1.5 block text-xs font-semibold text-ink-soft">見積名</span>
                <Input
                  type="search"
                  name="q"
                  defaultValue={sp.q ?? ''}
                  placeholder="見積名を検索"
                  className="h-10 min-h-10 w-full px-3 text-sm"
                />
              </label>
              <div className="flex shrink-0 gap-1.5">
                <button type="submit" className="btn-secondary btn-sm min-h-10 px-4">絞り込む</button>
                {hasFilters && (
                  <Link href="/admin/estimate-templates" className="btn-ghost btn-sm min-h-10 px-3">
                    クリア
                  </Link>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[40rem]">
            <div className={`${LIST_GRID} border-b border-line bg-sand/40 px-2 py-2 text-xs font-semibold text-ink-soft`}>
              <div>見積名</div>
              <div className="text-right">原価税込</div>
              <div className="text-right">売価税込</div>
              <div className="text-right">粗利率</div>
              <div>状態</div>
            </div>

            <Link
              href={sampleHref(modelId, qRaw)}
              aria-current={sampleSelected ? 'true' : undefined}
              className={`${LIST_GRID} min-h-12 border-b border-line px-2 py-2 text-sm transition ${
                sampleSelected
                  ? 'border-l-4 border-l-amber-500 bg-amber-50 pl-1'
                  : 'bg-amber-50/50 hover:bg-amber-50'
              }`}
            >
              <div className="min-w-0">
                <span className="font-semibold text-ink">動作確認サンプル（Wing ホテル仕様）</span>
                <p className="mt-0.5 text-[10px] text-muted">保存されない画面確認用データ</p>
              </div>
              <div className="text-right font-semibold tabular-nums">{formatYen(SAMPLE_PRICING.costTaxIncluded)}</div>
              <div className="text-right font-semibold tabular-nums">{formatYen(SAMPLE_PRICING.saleTaxIncluded)}</div>
              <div className="text-right font-semibold tabular-nums">{SAMPLE_PRICING.marginRate}</div>
              <div><Badge tone="neutral">サンプル</Badge></div>
            </Link>

            {groups.length > 0 ? groups.map((group, groupIndex) => {
                const displayModelName = group.model.name === 'フラット' ? 'Flat' : group.model.name;
                const selectedGroup = selected?.model.id === group.model.id;
                return (
                  <details
                    key={group.model.id}
                    open={Boolean(modelId) || groupIndex === 0 || selectedGroup}
                    className="group border-b border-line"
                  >
                    <summary className="list-none cursor-pointer bg-[#eaf4ee] px-3 py-2 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                        <span className="text-xs transition-transform group-open:rotate-90">▶</span>
                        <span>{displayModelName}</span>
                        <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-soft">
                          {group.choices.length}件
                        </span>
                      </div>
                    </summary>

                    <div className="divide-y divide-line">
                      {group.choices.map((choice) => {
                        const template = choice.template?.template ?? null;
                        const active =
                          selected?.model.id === group.model.id &&
                          selected?.choice.code === choice.code;
                        return (
                          <Link
                            key={choice.code}
                            href={selectionHref(modelId, qRaw, group.model.id, choice.code)}
                            aria-current={active ? 'true' : undefined}
                            className={`${LIST_GRID} min-h-12 px-2 py-2 text-sm transition ${
                              active
                                ? 'border-l-4 border-l-forest bg-[#f0f7f3] pl-1'
                                : 'bg-white hover:bg-sand/30'
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-ink">{choice.name}</span>
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div className="text-right font-semibold">
                              {template ? formatYen(template.total) : <span className="text-xs font-normal leading-tight text-muted">シミュレーターで算出</span>}
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div>
                              {template ? (
                                <Badge tone="neutral">登録済み</Badge>
                              ) : (
                                <span className="inline-flex rounded-full border border-line bg-sand/40 px-1.5 py-1 text-[0.7rem] font-semibold leading-tight text-muted">
                                  未登録
                                </span>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </details>
                );
              }) : (
                <div className="col-span-5 px-6 py-8 text-center">
                  <p className="text-sm font-semibold">条件に一致する正式な標準見積がありません</p>
                  <p className="mt-1 text-xs text-muted">上の動作確認サンプルは引き続き確認できます。</p>
                </div>
              )}
          </div>
        </div>

      </section>

      {sampleSelected && sampleCatalog && sampleSpecCode ? (
        <StandardEstimateSimulatorPreview
          bundle={sampleCatalog}
          specCode={sampleSpecCode}
          template={null}
          sampleMode
        />
      ) : selected && selectedCatalog ? (
        <StandardEstimateSimulatorPreview
          bundle={selectedCatalog}
          specCode={selected.choice.code}
          template={selected.choice.template}
        />
      ) : null}
    </AdminPage>
  );
}
