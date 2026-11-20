import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getProductConfigurationIdsForOption } from '@/lib/data/product-ledger-usage';
import { formatYen } from '@/lib/domain/pricing';
import { CONFIGURATION_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';

export default async function AdminConfigurationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff('/admin/configurations');
  const store = await getStore();
  const [configurations, models] = await Promise.all([store.listAllConfigurations(), store.listModels({ includeDraft: true })]);
  const nameOf = new Map(models.map((m) => [m.id, m.name]));
  // 商品台帳の「保存プラン N件」から来た場合だけ、保存済み構成の直接参照で絞り込む。
  // 不正な商品IDでは全件表示に戻さず0件にする。リクエストの権限は従来のrequireStaffを維持。
  const optionId = typeof sp.option_id === 'string' ? sp.option_id.trim() : null;
  const validOptionId = optionId !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(optionId);
  const [matchingIds, filteredOption] = validOptionId
    ? await Promise.all([getProductConfigurationIdsForOption(optionId), store.getOption(optionId)])
    : [new Set<string>(), null];
  const optionConfigurations = optionId === null
    ? configurations
    : configurations.filter((configuration) => matchingIds.has(configuration.id));

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
        optionConfigurations
          .map((configuration) => parseAddress(locationOf(configuration).address))
          .filter((address) => address.prefecture === filter.pref && address.city)
          .map((address) => address.city as string)
      )].sort()
    : [];
  const shown = optionConfigurations.filter((configuration) => matchesRegion(locationOf(configuration).address, filter));

  return (
    <AdminPage title="保存済み仕様" lead={optionId === null
      ? `シミュレーター等で保存されている仕様 ${configurations.length} 件。状態は既存Configurationの値をそのまま表示します。`
      : `対象商品を使用している保存プラン ${optionConfigurations.length} 件。`}>
      {optionId !== null && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sand/35 px-4 py-3 text-sm" data-testid="configuration-option-filter">
          <div>
            <p className="font-semibold text-ink">
              {validOptionId ? `商品「${filteredOption?.name ?? '商品IDを確認できません'}」の保存プラン ${optionConfigurations.length}件` : '商品IDが正しくありません'}
            </p>
            <p className="mt-1 text-xs text-muted">保存済み構成から直接参照しているプランのみ表示しています。標準見積・発行済み見積は含みません。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={validOptionId ? `/admin/ledger?product=${optionId}` : '/admin/ledger'} className="text-xs font-medium text-brown underline underline-offset-2">商品台帳へ戻る</Link>
            <Link href="/admin/configurations" className="btn-secondary btn-sm">絞り込み解除</Link>
          </div>
        </div>
      )}
      <RegionFilter value={filter} cities={cityPool} total={optionConfigurations.length} matched={shown.length} />
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
