import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { VIEW_LABELS } from '@/lib/domain/types';
import { Badge } from '@/components/ui';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminOptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const [options, categories] = await Promise.all([store.listOptions(), store.listCategories()]);
  return (
    <AdminPage title="オプション" lead="名称・説明・価格・画像・選択ルール（前提／同時選択不可）・プレビューキーを管理します。" actions={<Link href="/admin/options/new" className="btn-primary btn-sm">新規作成</Link>}>
      <FlashMessages sp={sp} />
      {categories.map((cat) => {
        const list = options.filter((o) => o.category_id === cat.id);
        if (!list.length) return null;
        return (
          <section key={cat.id}>
            <h2 className="mb-2 text-lg">{cat.name} <span className="text-xs text-muted">{cat.selection_mode === 'single' ? '1つ選択' : '複数選択'}{cat.is_required ? '・必須' : ''}</span></h2>
            <Table>
              <thead className="bg-sand/60"><tr><Th>名称</Th><Th>コード</Th><Th right>価格</Th><Th>プレビュー</Th><Th>フラグ</Th><Th>公開</Th><Th></Th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.map((o) => (
                  <tr key={o.id} data-testid={`admin-option-${o.code}`}>
                    <Td className="font-semibold">{o.name}</Td>
                    <Td className="font-mono text-xs">{o.code}</Td>
                    <Td right>{o.price_on_request ? '要見積' : formatYen(o.price)}</Td>
                    <Td className="text-xs">{o.preview_key ? <>{o.preview_key}<br /><span className="text-muted">{o.affects_views.map((v) => VIEW_LABELS[v]).join('・')}</span></> : <span className="text-muted">—</span>}</Td>
                    <Td className="space-x-1 text-xs">
                      {o.is_default && <Badge>初期選択</Badge>}
                      {o.is_required && <Badge tone="warn">必須</Badge>}
                      {o.is_installation && <Badge tone="navy">設置関連</Badge>}
                    </Td>
                    <Td><Badge tone={o.status === 'published' ? 'success' : 'neutral'}>{o.status === 'published' ? '公開' : '非公開'}</Badge></Td>
                    <Td right><Link href={`/admin/options/${o.id}`} className="btn-secondary btn-sm">編集</Link></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        );
      })}
    </AdminPage>
  );
}
