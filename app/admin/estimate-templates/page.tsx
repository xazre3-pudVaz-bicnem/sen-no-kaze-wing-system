import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { simulatorEstimateChoices } from '@/lib/domain/estimate-template';
import { formatYen } from '@/lib/domain/pricing';
import type { EstimateTemplateBundle } from '@/lib/domain/types';
import { Badge, Input } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';

function filterHref(model: string, q: string) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/admin/estimate-templates?${query}` : '/admin/estimate-templates';
}

const LIST_GRID =
  'grid grid-cols-[minmax(12rem,2fr)_8rem_9rem_9rem_6rem_9rem] items-center';

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

  const totalChoices = groups.reduce((sum, group) => sum + group.choices.length, 0);

  return (
    <AdminPage
      title="標準見積"
      lead="シミュレーターで現在選択できる標準見積を一覧で確認し、登録済みの標準見積を管理します。"
      actions={
        <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
          ＋ 新規標準見積を作成
        </Link>
      }
    >
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-semibold">標準見積一覧</h2>
            <p className="mt-1 text-xs text-muted">
              シミュレーターの「仕様を選ぶ」と同じ候補を、商品モデルごとに表示します。
            </p>
          </div>
          <Link href="/admin/estimate-templates/demo" className="btn-secondary btn-sm">
            操作確認用サンプル
          </Link>
        </div>

        <div className="border-b border-line bg-sand/20 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2" aria-label="商品モデル">
            <Link
              href={filterHref('', qRaw)}
              aria-current={!modelId ? 'page' : undefined}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
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
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
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

          <form method="get" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            {modelId && <input type="hidden" name="model" value={modelId} />}
            <label className="block min-w-0 flex-1">
              <span className="label">検索</span>
              <Input
                type="search"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="見積名を検索"
                className="mt-1 w-full"
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-secondary btn-sm">絞り込む</button>
              {hasFilters && (
                <Link href="/admin/estimate-templates" className="btn-ghost btn-sm">
                  条件をクリア
                </Link>
              )}
            </div>
          </form>
        </div>

        <div className="border-b border-line bg-blue-50/60 px-4 py-2.5 text-xs text-navy sm:px-5">
          防火仕様はシミュレーターでは標準見積とは別のプルダウンで選択するため、この一覧では「別選択」と表示します。
          原価・粗利率は現在の旧標準見積データに正式値がないため推測しません。
        </div>

        {groups.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[58rem]">
              <div className={`${LIST_GRID} border-b border-line bg-sand/40 px-3 py-2 text-xs font-semibold text-ink-soft`}>
                <div>見積名</div>
                <div>防火</div>
                <div className="text-right">原価税込</div>
                <div className="text-right">売価税込</div>
                <div className="text-right">粗利率</div>
                <div>状態</div>
              </div>

              {groups.map((group, groupIndex) => {
                const displayModelName = group.model.name === 'フラット' ? 'Flat' : group.model.name;
                return (
                  <details
                    key={group.model.id}
                    open={Boolean(modelId) || groupIndex === 0}
                    className="group border-b border-line"
                  >
                    <summary className="list-none cursor-pointer bg-[#eaf4ee] px-3 py-2 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                        <span className="text-xs transition-transform group-open:rotate-90">▶</span>
                        <span>{displayModelName}</span>
                        <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-soft">
                          {group.choices.length}件
                        </span>
                        <span className="text-xs font-normal text-muted">
                          {Boolean(modelId) || groupIndex === 0 ? '選択中' : 'クリックで展開'}
                        </span>
                      </div>
                    </summary>

                    <div className="divide-y divide-line">
                      {group.choices.map((choice) => {
                        const template = choice.template?.template ?? null;
                        return (
                          <div
                            key={choice.code}
                            className={`${LIST_GRID} min-h-12 bg-white px-3 py-2 text-sm`}
                          >
                            <div className="min-w-0">
                              {template ? (
                                <Link
                                  href={'/admin/estimate-templates/' + template.id}
                                  className="font-semibold text-ink underline-offset-4 hover:underline"
                                >
                                  {choice.name}
                                </Link>
                              ) : (
                                <span className="font-semibold">{choice.name}</span>
                              )}
                              <p className="mt-0.5 truncate text-xs text-muted">{choice.code}</p>
                            </div>
                            <div>
                              <span className="text-xs text-muted">別選択</span>
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div className="text-right font-semibold">
                              {template ? formatYen(template.total) : <span className="text-xs font-normal text-muted">シミュレーターで算出</span>}
                            </div>
                            <div className="text-right text-muted">—</div>
                            <div>
                              {template ? (
                                <Badge tone="neutral">登録済み</Badge>
                              ) : (
                                <span className="inline-flex rounded-full border border-line bg-sand/40 px-2 py-1 text-xs font-semibold text-muted">
                                  シミュレーター候補
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <h2 className="text-lg font-semibold">条件に一致する標準見積がありません</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              検索条件を変更するか、条件をクリアしてもう一度確認してください。
            </p>
            <div className="mt-5 flex justify-center">
              <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">
                条件をクリア
              </Link>
            </div>
          </div>
        )}

        <div className="border-t border-line bg-sand/20 px-4 py-3 text-xs text-muted sm:px-5">
          シミュレーター候補 {totalChoices}件。
          「登録済み」は旧標準見積データが存在し、シミュレーターがその売価を基準に使用できる候補です。
          未登録候補は現行シミュレーターの従来計算へフォールバックします。
        </div>
      </section>
    </AdminPage>
  );
}
