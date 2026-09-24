import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { CONFIGURATION_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';
import { CaseManagementNav } from '@/components/admin/case-management-nav';

export default async function AdminConfigurationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requireStaff('/admin/configurations');
  const store = await getStore();
  const [configurations, models] = await Promise.all([store.listAllConfigurations(), store.listModels({ includeDraft: true })]);
  const nameOf = new Map(models.map((m) => [m.id, m.name]));

  const locationOf = (configuration: (typeof configurations)[number]) => {
    if (configuration.site_location_undecided) {
      return { address: '', display: '未定', fromCustomerAddress: false };
    }
    const siteAddress = [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join('');
    const customerAddress = configuration.user_address ?? '';
    return {
      address: siteAddress || customerAddress,
      display: siteAddress || customerAddress || '—',
      fromCustomerAddress: !siteAddress && Boolean(customerAddress),
    };
  };

  // 地域で抽出（設置予定地を優先。未登録時のみ顧客住所へフォールバック）
  const filter = readRegionFilter(sp);
  const cityPool = filter.pref
    ? [...new Set(
        configurations
          .map((configuration) => parseAddress(locationOf(configuration).address))
          .filter((address) => address.prefecture === filter.pref && address.city)
          .map((address) => address.city as string)
      )].sort()
    : [];
  const shown = configurations.filter((configuration) => matchesRegion(locationOf(configuration).address, filter));

  return (
    <AdminPage title="保存済み仕様" lead={`シミュレーター等で保存されている仕様 ${configurations.length} 件。状態は既存Configurationの値をそのまま表示します。`}>
      <CaseManagementNav role={actor.role} active="saved" savedCount={configurations.length} />
      <RegionFilter value={filter} cities={cityPool} total={configurations.length} matched={shown.length} />
      <p className="text-xs text-muted">
        地域は設置予定地を優先し、未登録時のみ顧客住所で判定します。「未定」は地域絞り込みの対象外です。
      </p>
      <Table minWidth="56rem">
        <thead className="bg-sand/60"><tr><Th>更新日時</Th><Th>保存名</Th><Th>モデル</Th><Th>顧客</Th><Th>設置予定地</Th><Th>状態</Th><Th right>合計（税込）</Th><Th></Th></tr></thead>
        <tbody className="divide-y divide-line">
          {shown.map((c) => (
            <tr key={c.id}>
              <Td>{formatDate(c.updated_at, true)}</Td>
              <Td className="font-semibold">{c.name}</Td>
              <Td>{nameOf.get(c.base_model_id)}</Td>
              <Td>{c.user_name}<br /><span className="text-xs text-muted">{c.user_email}</span></Td>
              <Td className="text-xs">
                {locationOf(c).display}
                {locationOf(c).fromCustomerAddress && (
                  <span className="mt-0.5 block text-[0.65rem] text-muted">顧客住所から参考表示</span>
                )}
              </Td>
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
