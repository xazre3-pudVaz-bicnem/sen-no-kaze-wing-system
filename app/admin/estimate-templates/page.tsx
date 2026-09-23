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
  const visibleModels = models.filter((model) => templates.some((template) => template.base_model_id === model.id));

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
        ) : (
          <div className="px-6 py-12 text-center">
            <h2 className="text-lg font-semibold">
              {hasFilters ? '条件に一致する標準見積がありません' : '標準見積はまだありません'}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
              {hasFilters
                ? '検索条件を変更するか、条件をクリアしてもう一度確認してください。'
                : '最初の標準見積を作成して、Webシミュレーターと案件見積の基準を登録します。'}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              {hasFilters ? (
                <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">条件をクリア</Link>
              ) : (
                <>
                  <Link href="/admin/estimate-templates/demo" className="btn-secondary btn-sm">操作確認用サンプルを開く</Link>
                  <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">＋ 最初の標準見積を作成</Link>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </AdminPage>
  );
}
