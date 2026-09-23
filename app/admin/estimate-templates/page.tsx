import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Badge, Input } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅・単身者',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function filterHref(model: string, q: string) {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/admin/estimate-templates?${query}` : '/admin/estimate-templates';
}

type SampleEstimateRow = {
  name: string;
  fire: boolean;
  cost: number;
  sale: number;
};

type SampleEstimateGroup = {
  name: 'Wing' | 'BOX' | 'Flat';
  rows: SampleEstimateRow[];
};

const SAMPLE_ESTIMATE_SOURCE = '20260901修正分類表見積書(20260923-023847).xlsx';

const SAMPLE_ESTIMATE_GROUPS: SampleEstimateGroup[] = [
  {
    name: 'Wing',
    rows: [
      { name: '本体', fire: false, cost: 991100, sale: 1487200 },
      { name: 'ホテルUB', fire: false, cost: 4978600, sale: 7389800 },
      { name: 'ホテルUB', fire: true, cost: 5259100, sale: 7810000 },
      { name: '単身者用', fire: false, cost: 4119500, sale: 6139100 },
      { name: '単身者用', fire: true, cost: 4160200, sale: 6199600 },
      { name: '事務所', fire: false, cost: 2120800, sale: 3181200 },
      { name: '事務所', fire: true, cost: 2165900, sale: 3249400 },
    ],
  },
  {
    name: 'BOX',
    rows: [
      { name: '本体', fire: false, cost: 544500, sale: 816200 },
      { name: 'ホテル単身者', fire: false, cost: 2589400, sale: 3812600 },
      { name: '水回りキット', fire: false, cost: 3147100, sale: 4648600 },
      { name: '水回りキット', fire: true, cost: 3217500, sale: 5085300 },
    ],
  },
  {
    name: 'Flat',
    rows: [
      { name: '本体', fire: false, cost: 529100, sale: 794200 },
      { name: '本体', fire: true, cost: 537900, sale: 807400 },
      { name: '物置事務所', fire: false, cost: 1324400, sale: 1732500 },
    ],
  },
];

const SAMPLE_GRID = 'grid grid-cols-[minmax(10rem,2fr)_6rem_9rem_9rem_6rem_8rem] items-center';

function marginPercent(cost: number, sale: number) {
  if (sale <= 0) return '—';
  return `${(((sale - cost) / sale) * 100).toFixed(1)}%`;
}

function MarginBadge({ cost, sale }: { cost: number; sale: number }) {
  const value = marginPercent(cost, sale);
  const numeric = Number.parseFloat(value);
  const tone = numeric >= 33 ? 'border-success/20 bg-success/10 text-success' : 'border-warn/25 bg-amber-50 text-warn';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

function SampleEstimateRows({ rows, highlightFirst = false }: { rows: SampleEstimateRow[]; highlightFirst?: boolean }) {
  return (
    <div className="divide-y divide-line">
      {rows.map((row, index) => (
        <div
          key={`${row.name}-${row.fire ? 'fire' : 'normal'}`}
          className={`${SAMPLE_GRID} min-h-12 px-3 py-2 text-sm ${
            highlightFirst && index === 0 ? 'border-l-4 border-l-success bg-success/5 pl-2' : 'bg-white'
          }`}
        >
          <div className="font-semibold">{row.name}</div>
          <div>
            {row.fire ? (
              <span className="inline-flex rounded-full border border-warn/25 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-warn">防火</span>
            ) : (
              <span className="text-muted">非防火</span>
            )}
          </div>
          <div className="text-right font-semibold">{formatYen(row.cost)}</div>
          <div className="text-right font-semibold">{formatYen(row.sale)}</div>
          <div className="text-right"><MarginBadge cost={row.cost} sale={row.sale} /></div>
          <div className="text-muted">—</div>
        </div>
      ))}
    </div>
  );
}

function StandardEstimateListSample() {
  return (
    <div>
      <div className="border-b border-line bg-amber-50/60 px-4 py-2.5 text-xs text-warn sm:px-5">
        DB未登録のため、現在は「{SAMPLE_ESTIMATE_SOURCE}」の14見積シートを画面見本として表示しています。
        金額はExcelの表示値を1円単位に丸めた見本で、DBの正式データではありません。
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          <div className={`${SAMPLE_GRID} border-b border-line bg-sand/40 px-3 py-2 text-xs font-semibold text-ink-soft`}>
            <div>見積名</div>
            <div>防火</div>
            <div className="text-right">原価税込</div>
            <div className="text-right">売価税込</div>
            <div className="text-right">粗利率</div>
            <div>状態</div>
          </div>

          {SAMPLE_ESTIMATE_GROUPS.map((group, groupIndex) => (
            <details key={group.name} open={groupIndex === 0} className="group border-b border-line">
              <summary className="list-none cursor-pointer bg-[#eaf4ee] px-3 py-2 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                  <span className="text-xs transition-transform group-open:rotate-90">▶</span>
                  <span>{group.name}</span>
                  <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-soft">{group.rows.length}件</span>
                  <span className="text-xs font-normal text-muted">{groupIndex === 0 ? '選択中' : 'クリックで展開'}</span>
                </div>
              </summary>
              <SampleEstimateRows rows={group.rows} highlightFirst={groupIndex === 0} />
            </details>
          ))}
        </div>
      </div>
      <div className="border-t border-line bg-sand/20 px-4 py-2.5 text-[11px] text-muted sm:px-5">
        販売費100%・経費15%・掛率150%は添付Excelの値です。状態はExcelにRevision情報がないため「—」としています。
        正式な原価・売価・状態はStandard Estimate Revision基盤へ移行後に表示します。
      </div>
    </div>
  );
}

export default async function EstimateTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireCatalogEditor('/admin/estimate-templates');
  const sp = await searchParams;
  const store = await getStore();
  const [models, templates] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
  ]);

  const modelMap = new Map(models.map((model) => [model.id, model]));
  const modelId = sp.model ?? '';
  const qRaw = (sp.q ?? '').trim();
  const q = qRaw.toLowerCase();
  const filtered = templates
    .filter((row) => !modelId || row.base_model_id === modelId)
    .filter((row) => {
      if (!q) return true;
      const modelName = modelMap.get(row.base_model_id)?.name ?? '';
      return [row.name, row.spec_code, row.source_sheet_name, modelName].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const hasFilters = Boolean(modelId || q);
  const visibleModels = models;

  return (
    <AdminPage
      title="標準見積"
      lead="標準見積を選び、原価・売価・粗利率と紐づくプランボードを確認・調整します。"
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
              編集する標準見積を選択します。商品モデルと見積名で絞り込めます。
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
            {visibleModels.map((model) => {
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
                  {model.name}
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
              {hasFilters && <Link href="/admin/estimate-templates" className="btn-ghost btn-sm">条件をクリア</Link>}
            </div>
          </form>
        </div>

        {filtered.length > 0 ? (
          <>
            <Table minWidth="56rem">
              <thead className="bg-sand/60">
                <tr>
                  <Th>見積名</Th>
                  <Th>防火</Th>
                  <Th right>原価税込</Th>
                  <Th right>売価税込</Th>
                  <Th right>粗利率</Th>
                  <Th>状態</Th>
                  <Th>更新日</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((template) => {
                  const model = modelMap.get(template.base_model_id);
                  return (
                    <tr key={template.id} className="hover:bg-sand/30">
                      <Td>
                        <Link
                          href={'/admin/estimate-templates/' + template.id}
                          className="font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          {template.name}
                        </Link>
                        <p className="mt-1 text-xs text-muted">
                          {model?.name ?? '—'} ／ {SPEC_LABELS[template.spec_code] ?? template.spec_code}
                        </p>
                      </Td>
                      <Td>
                        <span className="text-sm text-muted">未設定</span>
                      </Td>
                      <Td right className="text-muted">—</Td>
                      <Td right className="font-semibold">{formatYen(template.total)}</Td>
                      <Td right className="text-muted">—</Td>
                      <Td>
                        <Badge tone="neutral">旧取込</Badge>
                      </Td>
                      <Td>{formatDate(template.updated_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="border-t border-line bg-sand/20 px-4 py-3 text-xs text-muted sm:px-5">
              原価税込・粗利率・正式な公開状態は、新しい標準見積Revision基盤との接続後に表示します。
              現在の一覧では旧取込データの売価税込だけを表示しています。
            </div>
          </>
        ) : hasFilters ? (
          <div className="px-6 py-12 text-center">
            <h2 className="text-lg font-semibold">条件に一致する標準見積がありません</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              検索条件を変更するか、条件をクリアしてもう一度確認してください。
            </p>
            <div className="mt-5 flex justify-center">
              <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">条件をクリア</Link>
            </div>
          </div>
        ) : (
          <StandardEstimateListSample />
        )}
      </section>
    </AdminPage>
  );
}
