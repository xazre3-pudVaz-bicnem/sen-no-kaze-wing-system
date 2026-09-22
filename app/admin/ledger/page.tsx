import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { canEditCatalog } from '@/lib/domain/types';
import { Badge, Input, Select } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';

/** 商品そのものを探して詳細を開く、商品台帳の入口。 */
export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const editor = canEditCatalog(actor.role);
  const sp = await searchParams;
  const store = await getStore();
  const [options, categories] = await Promise.all([store.listOptions(), store.listCategories()]);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const q = (sp.q ?? '').trim().toLowerCase();
  const categoryId = sp.category ?? '';
  const filtered = options.filter((option) => {
    if (categoryId && option.category_id !== categoryId) return false;
    if (!q) return true;
    return [option.name, option.manufacturer ?? '', option.model_no ?? '', categoryMap.get(option.category_id)?.name ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  return (
    <AdminPage
      title="商品台帳"
      lead="商品名・メーカー・型番・カテゴリーから商品を探します。販売基準や標準見積の管理はここでは行いません。"
      actions={<>{editor && <Link href="/admin/import" className="btn-secondary btn-sm">一括登録</Link>}{editor && <Link href="/admin/categories" className="btn-secondary btn-sm">分類・カテゴリー</Link>}{editor && <Link href="/admin/options/new" className="btn-primary btn-sm">商品を追加</Link>}</>}
    >
      <FlashMessages sp={sp} />
      <form method="get" className="card grid gap-3 p-4 sm:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.55fr)_auto] sm:items-end">
        <label className="block"><span className="label">商品を検索</span><Input type="search" name="q" defaultValue={sp.q ?? ''} placeholder="商品名・メーカー・型番" className="mt-1 w-full" /></label>
        <label className="block"><span className="label">カテゴリー</span><Select name="category" defaultValue={categoryId} className="mt-1 w-full"><option value="">すべて</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
        <div className="flex gap-2"><button type="submit" className="btn-secondary btn-sm">絞り込む</button>{(q || categoryId) && <Link href="/admin/ledger" className="btn-ghost btn-sm">クリア</Link>}</div>
      </form>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted">{filtered.length === options.length ? `${options.length}商品` : `${filtered.length} / ${options.length}商品を表示`}</p>{editor && <Link href="/admin/options" className="text-sm font-semibold text-brown underline underline-offset-4">登録・編集一覧へ</Link>}</div>
      {filtered.length ? (
        <Table>
          <thead className="bg-sand/60"><tr><Th>商品</Th><Th>カテゴリー</Th><Th>対象モデル</Th><Th right>商品価格（税別）</Th><Th>状態</Th><Th /></tr></thead>
          <tbody className="divide-y divide-line">
            {filtered.map((option) => {
              const category = categoryMap.get(option.category_id);
              return <tr key={option.id} data-testid={`ledger-option-${option.code}`}>
                <Td><div className="flex min-w-[18rem] items-center gap-3"><div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-sand">{option.image_url ? <SmartImage src={option.image_url} alt="" fill sizes="56px" className="object-contain" /> : <span className="flex h-full items-center justify-center text-[0.65rem] text-muted">画像なし</span>}</div><div className="min-w-0"><p className="font-semibold">{option.name}</p><p className="mt-0.5 truncate text-xs text-muted">{[option.manufacturer, option.model_no].filter(Boolean).join(' ／ ') || option.code}</p></div></div></Td>
                <Td><div className="text-sm">{category?.name ?? '—'}</div>{category?.group_name && <div className="mt-0.5 text-xs text-muted">{category.group_name}</div>}</Td>
                <Td><span className="text-sm">{option.base_model_id ? '特定モデル' : '全モデル共通'}</span></Td>
                <Td right><span className="font-semibold">{option.price_on_request ? '別途見積' : formatYen(option.price)}</span></Td>
                <Td><Badge tone={option.status === 'published' ? 'success' : 'neutral'}>{option.status === 'published' ? '公開済み' : '非公開'}</Badge></Td>
                <Td right><Link href={`/admin/options/${option.id}`} className="btn-secondary btn-sm">詳細</Link></Td>
              </tr>;
            })}
          </tbody>
        </Table>
      ) : <div className="card px-5 py-10 text-center text-sm text-muted">条件に一致する商品がありません。</div>}
    </AdminPage>
  );
}
