import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Badge, Input, Select } from '@/components/ui';
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

function SelectWithArrow({
  name,
  defaultValue,
  children,
}: {
  name: string;
  defaultValue: string;
  children: ReactNode;
}) {
  return (
    <div className="relative mt-1">
      <Select name={name} defaultValue={defaultValue} className="w-full pr-10">
        {children}
      </Select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted"
      >
        ▼
      </span>
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
  const q = (sp.q ?? '').trim().toLowerCase();
  const filtered = templates
    .filter((row) => !modelId || row.base_model_id === modelId)
    .filter((row) => {
      if (!q) return true;
      const modelName = modelMap.get(row.base_model_id)?.name ?? '';
      return [row.name, row.spec_code, row.source_sheet_name, modelName].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const hasFilters = Boolean(modelId || q);

  return (
    <AdminPage
      title="標準見積"
      lead="Webシミュレーター・案件見積の販売基準となる標準見積を管理します。"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/estimate-templates/demo" className="btn-secondary btn-sm">操作確認用サンプル</Link>
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">＋ 新規作成</Link>
        </div>
      }
    >
      <section className="card p-4">
        <div className="mb-3">
          <p className="text-sm font-semibold">一覧の絞り込み</p>
          <p className="mt-1 text-xs text-muted">商品や標準見積名・仕様で、下の一覧を探しやすくするための検索です。複製には使用しません。</p>
        </div>
        <form method="get" className="grid gap-3 sm:grid-cols-[minmax(12rem,0.5fr)_minmax(16rem,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="label">商品</span>
            <SelectWithArrow name="model" defaultValue={modelId}>
              <option value="">すべて</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </SelectWithArrow>
          </label>
          <label className="block">
            <span className="label">検索</span>
            <Input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="標準見積名・仕様"
              className="mt-1 w-full"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-secondary btn-sm">絞り込む</button>
            {hasFilters && <Link href="/admin/estimate-templates" className="btn-ghost btn-sm">クリア</Link>}
          </div>
        </form>
      </section>

      {filtered.length > 0 ? (
        <Table minWidth="56rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>商品</Th>
              <Th>標準見積名</Th>
              <Th>仕様</Th>
              <Th>作成元・利用地域</Th>
              <Th>公開状況</Th>
              <Th right>税込金額</Th>
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
                  <Td>
                    <p>{SPEC_LABELS[template.spec_code] ?? template.spec_code}</p>
                    <p className="mt-0.5 text-xs text-muted">防火：未設定</p>
                  </Td>
                  <Td>
                    <p>本部（移行元）</p>
                    <p className="mt-0.5 text-xs text-muted">全国</p>
                  </Td>
                  <Td>
                    <Badge tone="neutral">取込済み</Badge>
                    <p className="mt-1 text-xs text-muted">公開版 —</p>
                  </Td>
                  <Td right className="font-semibold">{formatYen(template.total)}</Td>
                  <Td>{formatDate(template.updated_at)}</Td>
                  <Td right>
                    <Link href={'/admin/estimate-templates/' + template.id} className="btn-secondary btn-sm">開く</Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <section className="card px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">
            {hasFilters ? '条件に一致する標準見積がありません' : '標準見積はまだありません'}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            {hasFilters
              ? '検索条件を変更するか、条件をクリアしてもう一度確認してください。'
              : '最初の標準見積を作成して、Webシミュレーターと案件見積の販売基準を登録します。'}
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
        </section>
      )}
    </AdminPage>
  );
}
