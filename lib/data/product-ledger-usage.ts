import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isLocalMode } from './store';
import { loadDb } from './local-db';

export type ProductConfigurationUsageCounts = Record<string, number>;

type ConfigurationItemUsageRow = {
  option_id: string;
  configuration_id: string;
};

function countDistinctConfigurations(rows: ConfigurationItemUsageRow[]): ProductConfigurationUsageCounts {
  const configurationIdsByOption = new Map<string, Set<string>>();

  for (const row of rows) {
    const ids = configurationIdsByOption.get(row.option_id) ?? new Set<string>();
    ids.add(row.configuration_id);
    configurationIdsByOption.set(row.option_id, ids);
  }

  return Object.fromEntries(
    Array.from(configurationIdsByOption.entries(), ([optionId, configurationIds]) => [optionId, configurationIds.size])
  );
}

/**
 * 商品台帳で表示する「保存済み構成での利用件数」。
 * configuration_items.option_id の直接参照だけを数え、標準見積・Quote・Snapshot の履歴は含めない。
 */
export async function getProductConfigurationUsageCounts(): Promise<ProductConfigurationUsageCounts> {
  if (isLocalMode()) {
    const db = loadDb();
    return countDistinctConfigurations(
      db.configurationItems.map((row) => ({ option_id: row.option_id, configuration_id: row.configuration_id }))
    );
  }

  const db = await createClient();
  const { data, error } = await db.from('configuration_items').select('option_id, configuration_id');
  if (error) throw new Error('商品利用状況を取得できませんでした');

  return countDistinctConfigurations((data ?? []) as ConfigurationItemUsageRow[]);
}
