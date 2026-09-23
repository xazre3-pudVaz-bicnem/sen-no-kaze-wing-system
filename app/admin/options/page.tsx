import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { Badge, Input, Select } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminOptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStaff();
  const editor = canEditCatalog(actor.role);
  const sp = await searchParams;
  const store = await getStore();
  const [options, categories] = await Promise.all([store.listOptions(), store.listCategories()]);
  const freeCategoryId = categories.find((category) => category.code === FREE_PRODUCT_CATEGORY_CODE)?.id;
  const catalogCategories = categories.filter((category) => category.code !== FREE_PRODUCT_CATEGORY_CODE);
  const catalogOptions = freeCategoryId ? options.filter((option) => option.category_id !== freeCategoryId) : options;
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  const q = (sp.q ?? '').trim().toLowerCase();
  const categoryId = sp.category ?? '';
  const status = sp.status ?? '';
  const filtered = catalogOptions.filter((option) => {
    if (categoryId && option.category_id !== categoryId) return false;
    if (status && option.status !== status) return false;
    if (!q) return true;
    const haystack = [
      option.name,
      option.product_no ?? '',
      option.code,
      option.manufacturer ?? '',
      option.model_no ?? '',
      option.size_note ?? '',
      categoryMap.get(option.category_id)?.name ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });

  return (
    <AdminPage
      title="商品登録・編集"
      lead="商品を探して編集します。細かな設定は商品詳細画面にまとめています。"
      actions={editor ? <Link href="/admin/options/new" className="btn-primary btn-sm">商品を追加</Link> : undefined}
    >
      <FlashMessages sp={sp} />

      <form method="get" className="card grid gap-3 p-4 sm:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.55fr)_10rem_auto] sm:items-end">
        <label className="block">
          <span className="label">商品を検索</span>
          <Input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="商品名・メーカー・型番・商品番号"
            className="mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="label">カテゴリー</span>
          <Select name="category" defaultValue={categoryId} className="mt-1 w-full">
            <option value="">すべて</option>
            {catalogCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="label">公開状態</span>
          <Select name="status" defaultValue={status} className="mt-1 w-full">
            <option value="">すべて</option>
            <option value="published">公開</option>
            <option value="draft">非公開</option>
          </Select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn-secondary btn-sm">絞り込む</button>
          {(q || categoryId || status) && <Link href="/admin/options" className="btn-ghost btn-sm">クリア</Link>}
        </div>
      </form>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {filtered.length === catalogOptions.length
            ? `${catalogOptions.length}商品`
            : `${filtered.length} / ${catalogOptions.length}商品を表示`}
        </p>
      </div>

      {filtered.length ? (
        <Table>
          <thead className="bg-sand/60">
            <tr>
              <Th>商品</Th>
              <Th>カテゴリー</Th>
              <Th right>商品価格（税別）</Th>
              <Th>公開</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((option) => {
              const category = categoryMap.get(option.category_id);
              return (
                <tr key={option.id} data-testid={`admin-option-${option.code}`}>
                  <Td>
                    <div className="flex min-w-[18rem] items-center gap-3">
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-sand">
                        {option.image_url ? (
                          <SmartImage src={option.image_url} alt="" fill sizes="56px" className="object-contain" />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[0.65rem] text-muted">画像なし</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold">{option.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {[option.manufacturer, option.model_no].filter(Boolean).join(' ／ ') || option.code}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="text-sm">{category?.name ?? '—'}</div>
                    {category?.group_name && <div className="mt-0.5 text-xs text-muted">{category.group_name}</div>}
                  </Td>
                  <Td right>
                    <span className="font-semibold">{option.price_on_request ? '別途見積' : formatYen(option.price)}</span>
                  </Td>
                  <Td>
                    <Badge tone={option.status === 'published' ? 'success' : 'neutral'}>
                      {option.status === 'published' ? '公開' : '非公開'}
                    </Badge>
                  </Td>
                  <Td right>
                    <Link href={`/admin/options/${option.id}`} className="btn-secondary btn-sm">{editor ? '詳細・編集' : '詳細'}</Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <div className="card px-5 py-10 text-center text-sm text-muted">
          条件に一致する商品がありません。
        </div>
      )}
    </AdminPage>
  );
}
