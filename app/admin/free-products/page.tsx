import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { Alert, Badge } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';

/**
 * フリー商品：代理店・工務店が自分で登録する商品（家具など）。
 * 見積書では「別途工事」の下に別枠で表示され、諸費用（15%）はかからない。
 */
export default async function AdminFreeProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const [categories, options, profiles] = await Promise.all([
    store.listCategories(),
    store.listOptions(),
    canEditCatalog(actor.role) ? store.listProfiles() : Promise.resolve([]),
  ]);
  const category = categories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const all = category ? options.filter((o) => o.category_id === category.id) : [];
  // 代理店は自分が登録したものだけ。総代理店以上は全件
  const mine = canEditCatalog(actor.role) ? all : all.filter((o) => o.owner_id === actor.id);
  const ownerName = new Map(profiles.map((p) => [p.id, p.company_name || p.full_name]));

  return (
    <AdminPage
      title="フリー商品"
      lead="代理店・工務店が自社で扱う商品（ベッド・イスなど）を登録します。お客様の見積書では「別途工事」の下に【フリー商品】として表示され、諸費用はかかりません。"
      actions={
        category ? (
          <Link href={`/admin/options/new?category=${category.id}`} className="btn-primary btn-sm">
            フリー商品を追加
          </Link>
        ) : null
      }
    >
      <FlashMessages sp={sp} />

      {!category && (
        <Alert tone="warn">
          「フリー商品」カテゴリーが見つかりません。マイグレーション <code>0010</code> の適用とシードの再実行が必要です。
        </Alert>
      )}

      {category && mine.length === 0 && (
        <Alert tone="info">
          まだ登録がありません。「フリー商品を追加」から、商品名・価格・画像を登録してください。
          {!canEditCatalog(actor.role) && ' 登録した商品は自分だけが編集できます。'}
        </Alert>
      )}

      {mine.length > 0 && (
        <Table>
          <thead className="bg-sand/60">
            <tr>
              <Th>画像</Th>
              <Th>商品名</Th>
              <Th>コード</Th>
              <Th right>価格</Th>
              {canEditCatalog(actor.role) && <Th>登録者</Th>}
              <Th>公開</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {mine.map((o) => (
              <tr key={o.id} data-testid={`free-product-${o.code}`}>
                <Td>
                  <span className="relative block size-10 overflow-hidden rounded bg-sand">
                    {o.image_url && <SmartImage src={o.image_url} alt="" fill sizes="40px" className="object-cover" />}
                  </span>
                </Td>
                <Td className="font-semibold">{o.name}</Td>
                <Td className="font-mono text-xs">{o.code}</Td>
                <Td right>{o.price_on_request ? '要見積' : formatYen(o.price)}</Td>
                {canEditCatalog(actor.role) && (
                  <Td className="text-xs text-muted">{o.owner_id ? (ownerName.get(o.owner_id) ?? '—') : '総代理店・管理者'}</Td>
                )}
                <Td>
                  <Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開' : '非公開'}</Badge>
                </Td>
                <Td right>
                  <Link href={`/admin/options/${o.id}`} className="btn-secondary btn-sm">
                    編集
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </AdminPage>
  );
}
