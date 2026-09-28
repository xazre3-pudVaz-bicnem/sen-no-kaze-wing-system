import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { simulatorEstimateChoices } from '@/lib/domain/estimate-template';
import { formatYen } from '@/lib/domain/pricing';
import type { EstimateTemplateBundle } from '@/lib/domain/types';
import { Badge } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { StandardEstimateSimulatorPreview } from '@/components/admin/standard-estimate-simulator-preview';

type FireFilter = '' | 'non_fire' | 'fire';

function filterHref(model: string, fire: FireFilter) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (fire) params.set('fire', fire);
  const query = params.toString();
  return query ? `/admin/estimate-templates?${query}` : '/admin/estimate-templates';
}

function selectionHref(
  model: string,
  fire: FireFilter,
  selectedModel: string,
  selectedSpec: string
) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (fire) params.set('fire', fire);
  params.set('selected_model', selectedModel);
  params.set('selected_spec', selectedSpec);
  return `/admin/estimate-templates?${params.toString()}#estimate-preview`;
}

function sampleHref(model: string, fire: FireFilter) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (fire) params.set('fire', fire);
  params.set('sample', '1');
  return `/admin/estimate-templates?${params.toString()}#estimate-preview`;
}

function fireSpecForChoice(
  choice: ReturnType<typeof simulatorEstimateChoices>[number]
): Exclude<FireFilter, ''> {
  return choice.template?.template.source_sheet_name.startsWith('【防火】') ? 'fire' : 'non_fire';
}

const LIST_GRID =
  'grid grid-cols-[minmax(14rem,2fr)_6.75rem_7rem_5.5rem_5.5rem_1.5rem] items-center gap-x-2';

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
  const fireFilter: FireFilter =
    sp.fire === 'fire' || sp.fire === 'non_fire' ? sp.fire : '';

  const allGroups = simulatorModels.map((model) => ({
    model,
    choices: simulatorEstimateChoices(model, bundlesByModel.get(model.id) ?? []),
  }));
  const modelScopeGroups = allGroups.filter((group) => !modelId || group.model.id === modelId);
  const groups = modelScopeGroups
    .map((group) => ({
      ...group,
      choices: group.choices.filter(
        (choice) => !fireFilter || fireSpecForChoice(choice) === fireFilter
      ),
    }))
    .filter((group) => group.choices.length > 0);

  const modelCounts = new Map(
    allGroups.map((group) => [
      group.model.id,
      group.choices.filter((choice) => !fireFilter || fireSpecForChoice(choice) === fireFilter).length,
    ])
  );
  const allModelCount = [...modelCounts.values()].reduce((sum, count) => sum + count, 0);
  const fireCounts = {
    all: modelScopeGroups.reduce((sum, group) => sum + group.choices.length, 0),
    non_fire: modelScopeGroups.reduce(
      (sum, group) => sum + group.choices.filter((choice) => fireSpecForChoice(choice) === 'non_fire').length,
      0
    ),
    fire: modelScopeGroups.reduce(
      (sum, group) => sum + group.choices.filter((choice) => fireSpecForChoice(choice) === 'fire').length,
      0
    ),
  };

  const sampleSelected = sp.sample === '1' && fireFilter !== 'fire';
  const sampleModel = simulatorModels.find((model) => model.slug === 'wing-01') ?? null;
  const sampleVisible = Boolean(
    sampleModel &&
      fireFilter !== 'fire' &&
      groups.some((group) => group.model.id === sampleModel.id)
  );
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
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{totalChoices}件</span>
            {sampleVisible && (
              <>
                <span aria-hidden="true">・</span>
                <span>動作確認用 1件</span>
              </>
            )}
          </div>
        </div>

        <div className="border-b border-line bg-sand/15 px-4 py-2.5 sm:px-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-semibold text-ink-soft">モデル</span>
              <div className="flex flex-wrap items-center gap-1.5" aria-label="商品モデル">
                <Link
                  href={filterHref('', fireFilter)}
                  aria-current={!modelId ? 'page' : undefined}
                  className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition ${
                    !modelId
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-white text-ink hover:bg-sand'
                  }`}
                >
                  <span>すべて</span>
                  <span className="text-[10px] opacity-70">{allModelCount}</span>
                </Link>
                {simulatorModels.map((model) => {
                  const active = model.id === modelId;
                  return (
                    <Link
                      key={model.id}
                      href={filterHref(model.id, fireFilter)}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition ${
                        active
                          ? 'border-forest bg-forest text-white'
                          : 'border-line bg-white text-ink hover:bg-sand'
                      }`}
                    >
                      <span>{model.name === 'フラット' ? 'Flat' : model.name}</span>
                      <span className="text-[10px] opacity-70">{modelCounts.get(model.id) ?? 0}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-semibold text-ink-soft">防火仕様</span>
              <div className="flex flex-wrap items-center gap-1.5" aria-label="防火仕様">
                {[
                  { value: '' as const, label: 'すべて', count: fireCounts.all },
                  { value: 'non_fire' as const, label: '非防火', count: fireCounts.non_fire },
                  { value: 'fire' as const, label: '防火', count: fireCounts.fire },
                ].map((item) => {
                  const active = fireFilter === item.value;
                  return (
                    <Link
                      key={item.value || 'all'}
                      href={filterHref(modelId, item.value)}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition ${
                        active
                          ? 'border-forest bg-forest text-white'
                          : 'border-line bg-white text-ink hover:bg-sand'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] opacity-70">{item.count}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[40rem]">
            <div className={`${LIST_GRID} border-b border-line bg-sand/35 px-3 py-1.5 text-xs font-semibold text-ink-soft`}>
              <div>見積名</div>
              <div className="text-right">原価税込</div>
              <div className="text-right">売価税込</div>
              <div className="text-right">粗利率</div>
              <div className="text-center">状態</div>
              <div aria-hidden="true" />
            </div>

            {groups.length > 0 ? groups.map((group, groupIndex) => {
                const displayModelName = group.model.name === 'フラット' ? 'Flat' : group.model.name;
                const selectedGroup = selected?.model.id === group.model.id;
                const sampleGroup = sampleModel?.id === group.model.id;
                return (
                  <details
                    key={group.model.id}
                    open={Boolean(modelId) || groupIndex === 0 || selectedGroup || (sampleSelected && sampleGroup)}
                    className="group border-b border-line"
                  >
                    <summary className="list-none cursor-pointer border-l-4 border-l-forest bg-sand/15 px-3 py-1.5 [&::-webkit-details-marker]:hidden hover:bg-sand/30">
                      <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                        <span className="text-xs transition-transform group-open:rotate-90">▶</span>
                        <span>{displayModelName}</span>
                        <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-soft">
                          {group.choices.length}件
                        </span>
                        {sampleGroup && (
                          <span className="text-[10px] font-medium text-muted">＋確認用1件</span>
                        )}
                      </div>
                    </summary>

                    <div className="divide-y divide-line">
                      {sampleGroup && (
                        <Link
                          href={sampleHref(modelId, fireFilter)}
                          aria-current={sampleSelected ? 'true' : undefined}
                          className={`${LIST_GRID} min-h-10 px-3 py-1.5 text-sm transition ${
                            sampleSelected
                              ? 'border-l-4 border-l-amber-500 bg-amber-50/90 shadow-[inset_0_0_0_1px_rgba(180,120,40,0.18)] pl-2'
                              : 'bg-amber-50/35 hover:bg-amber-50/70'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2 pl-4">
                            <span className="truncate font-semibold text-ink">Wing ホテル仕様</span>
                            <Badge tone="warn" className="shrink-0">動作確認用</Badge>
                            {sampleSelected && (
                              <span className="shrink-0 rounded-full bg-forest px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                選択中
                              </span>
                            )}
                          </div>
                          <div className="text-right font-semibold tabular-nums">{formatYen(SAMPLE_PRICING.costTaxIncluded)}</div>
                          <div className="text-right font-semibold tabular-nums">{formatYen(SAMPLE_PRICING.saleTaxIncluded)}</div>
                          <div className="text-right font-semibold tabular-nums">{SAMPLE_PRICING.marginRate}</div>
                          <div className="text-center"><Badge tone="neutral">サンプル</Badge></div>
                          <div className="text-right text-lg leading-none text-muted" aria-hidden="true">›</div>
                        </Link>
                      )}
                      {group.choices.map((choice) => {
                        const template = choice.template?.template ?? null;
                        const active =
                          selected?.model.id === group.model.id &&
                          selected?.choice.code === choice.code;
                        return (
                          <Link
                            key={choice.code}
                            href={selectionHref(modelId, fireFilter, group.model.id, choice.code)}
                            aria-current={active ? 'true' : undefined}
                            className={`${LIST_GRID} min-h-10 px-3 py-1.5 text-sm transition ${
                              active
                                ? 'border-l-4 border-l-forest bg-[#e4f1e8] shadow-[inset_0_0_0_1px_rgba(35,93,68,0.18)] pl-2'
                                : 'bg-white hover:bg-sand/30'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2 pl-4">
                              <span className="truncate font-semibold text-ink">{choice.name}</span>
                              {active && (
                                <span className="shrink-0 rounded-full bg-forest px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  選択中
                                </span>
                              )}
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div className="text-right font-semibold">
                              {template ? (
                                <span className="tabular-nums">{formatYen(template.total)}</span>
                              ) : (
                                <span className="font-normal text-muted">—</span>
                              )}
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div className="text-center">
                              {template ? (
                                <Badge tone="success">登録済み</Badge>
                              ) : (
                                <Badge tone="neutral">未登録</Badge>
                              )}
                            </div>
                            <div className="text-right text-lg leading-none text-muted" aria-hidden="true">›</div>
                          </Link>
                        );
                      })}
                    </div>
                  </details>
                );
              }) : (
                <div className="col-span-6 px-6 py-8 text-center">
                  <p className="text-sm font-semibold">条件に一致する正式な標準見積がありません</p>
                  <p className="mt-1 text-xs text-muted">商品モデルや防火仕様を変更して確認してください。</p>
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
