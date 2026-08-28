import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { CONFIGURATION_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';

export default async function AdminConfigurationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = await getStore();
  const [configurations, models] = await Promise.all([store.listAllConfigurations(), store.listModels({ includeDraft: true })]);
  const nameOf = new Map(models.map((m) => [m.id, m.name]));

  // 地域で抽出（顧客住所で判定）
  const filter = readRegionFilter(sp);
  const cityPool = filter.pref
    ? [...new Set(
        configurations
          .map((c) => parseAddress(c.user_address))
          .filter((a) => a.prefecture === filter.pref && a.city)
          .map((a) => a.city as string)
      )].sort()
    : [];
  const shown = configurations.filter((c) => matchesRegion(c.user_address, filter));

  return (
    <AdminPage title="保存された仕様" lead={`全顧客の保存データ ${configurations.length} 件`}>
      <RegionFilter value={filter} cities={cityPool} total={configurations.length} matched={shown.length} />
      <Table minWidth="56rem">
        <thead className="bg-sand/60"><tr><Th>更新日時</Th><Th>保存名</Th><Th>モデル</Th><Th>顧客</Th><Th>住所</Th><Th>状態</Th><Th right>合計（税込）</Th><Th></Th></tr></thead>
        <tbody className="divide-y divide-line">
          {shown.map((c) => (
            <tr key={c.id}>
              <Td>{formatDate(c.updated_at, true)}</Td>
              <Td className="font-semibold">{c.name}</Td>
              <Td>{nameOf.get(c.base_model_id)}</Td>
              <Td>{c.user_name}<br /><span className="text-xs text-muted">{c.user_email}</span></Td>
              <Td className="text-xs">{c.user_address ?? '—'}</Td>
              <Td><Badge>{CONFIGURATION_STATUS_LABELS[c.status]}</Badge></Td>
              <Td right>{formatYen(c.total)}</Td>
              <Td right><Link href={`/admin/configurations/${c.id}`} className="btn-secondary btn-sm">確認</Link></Td>
            </tr>
          ))}
          {shown.length === 0 && <tr><Td className="text-center text-muted">条件に合う保存データはありません</Td></tr>}
        </tbody>
      </Table>
    </AdminPage>
  );
}
