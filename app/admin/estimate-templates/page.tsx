import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge, Input, Select } from '@/components/ui';
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
  const q = (sp.q ?? '').trim().toLowerCase();
  const filtered = templates
    .filter((row) => !modelId || row.base_model_id === modelId)
    .filter((row) => {
      if (!q) return true;
      const modelName = modelMap.get(row.base_model_id)?.name ?? '';
      return [row.name, row.spec_code, row.source_sheet_name, modelName].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return (
    <AdminPage
      title="見積テンプレート"
      lead="Webシミュレーター・案件見積の基準となる見積テンプレートを管理します。"
      actions={<Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">＋ 新規作成</Link>}
    >
      <Alert tone="info">
        新しい見積テンプレート画面のUI確認版です。現在は既存の分類表見積データを読み込んで表示しています。
        保存・複製・本部承認・公開は、画面確認後のDB／権限設計工程で接続します。
        旧Excel取込画面は <Link href="/admin/base-breakdown" className="font-semibold underline underline-offset-4">標準見積・本体内訳</Link> から確認できます。
      </Alert>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">承認待ち 0件</Badge>
          <span className="text-muted">本部承認フローは次工程で接続します。</span>
        </div>
        <form method="get" className="grid gap-3 sm:grid-cols-[minmax(12rem,0.5fr)_minmax(16rem,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="label">商品</span>
            <Select name="model" defaultValue={modelId} className="mt-1 w-full">
              <option value="">すべて</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="label">検索</span>
            <Input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="テンプレート名・仕様・Excelシート名"
              className="mt-1 w-full"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-secondary btn-sm">絞り込む</button>
            {(modelId || q) && <Link href="/admin/estimate-templates" className="btn-ghost btn-sm">クリア</Link>}
          </div>
        </form>
      </section>

      <Table minWidth="76rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>商品</Th>
            <Th>テンプレート名</Th>
            <Th>用途・仕様</Th>
            <Th>防火</Th>
            <Th>作成元</Th>
            <Th>利用地域</Th>
            <Th>公開版</Th>
            <Th right>税込金額</Th>
            <Th>状態</Th>
            <Th>更新日</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {filtered.map((template) => {
            const model = modelMap.get(template.base_model_id);
            return (
              <tr key={template.id}>
                <Td className="font-semibold">{model?.name ?? '—'}</Td>
                <Td>
                  <p className="font-semibold">{template.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{template.source_sheet_name}</p>
                </Td>
                <Td>{SPEC_LABELS[template.spec_code] ?? template.spec_code}</Td>
                <Td>未設定</Td>
                <Td>本部（移行元）</Td>
                <Td>全国</Td>
                <Td>—</Td>
                <Td right className="font-semibold">{formatYen(template.total)}</Td>
                <Td><Badge tone="neutral">取込済み</Badge></Td>
                <Td>{formatDate(template.updated_at)}</Td>
                <Td right>
                  <Link href={'/admin/estimate-templates/' + template.id} className="btn-secondary btn-sm">開く</Link>
                </Td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <Td colSpan={11} className="py-10 text-center text-muted">
                条件に一致する見積テンプレートがありません。
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      <p className="text-xs text-muted">
        画面接続後は「公開中・下書きあり・本部承認待ち・差し戻し・未公開」を状態として表示し、公開版と編集中の版を分けて管理します。
      </p>
    </AdminPage>
  );
}
