import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, FlashMessages, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });
  return (
    <AdminPage title="ベースコンテナ" lead="商品の基本情報・価格・公開状態・画像を管理します。" actions={<Link href="/admin/models/new" className="btn-primary btn-sm">新規作成</Link>}>
      <FlashMessages sp={sp} />
      <Table>
        <thead className="bg-sand/60"><tr><Th>商品名</Th><Th>slug</Th><Th right>ベース価格（税別）</Th><Th>公開</Th><Th>更新日</Th><Th></Th></tr></thead>
        <tbody className="divide-y divide-line">
          {models.map((m) => (
            <tr key={m.id}>
              <Td className="font-semibold">{m.name}</Td>
              <Td className="font-mono text-xs">{m.slug}</Td>
              <Td right>{formatYen(m.base_price)}</Td>
              <Td><Badge tone={m.status === 'published' ? 'success' : 'neutral'}>{m.status === 'published' ? '公開' : '非公開'}</Badge></Td>
              <Td>{formatDate(m.updated_at)}</Td>
              <Td right><Link href={`/admin/models/${m.id}`} className="btn-secondary btn-sm">編集</Link></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminPage>
  );
}
