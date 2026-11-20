import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledgerPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const ledgerClient = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const usage = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/product-ledger-usage.ts'), 'utf8');
const configurationsPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/configurations/page.tsx'), 'utf8');
const configurationDetail = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/configurations/[id]/page.tsx'), 'utf8');
const regionFilter = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/region-filter.tsx'), 'utf8');
const supabaseStore = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/supabase-store.ts'), 'utf8');
const localStore = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/local-store.ts'), 'utf8');

describe('商品台帳の保存済み構成利用状況', () => {
  it('configuration_items の直接参照だけを構成単位で集計する', () => {
    expect(usage).toContain("db.from('configuration_items').select('option_id, configuration_id')");
    expect(usage).toContain('new Map<string, Set<string>>()');
    expect(usage).toContain('ids.add(row.configuration_id)');
    expect(usage).toContain('configurationIds.size');
    expect(usage).toContain('標準見積・Quote・Snapshot の履歴は含めない');
  });

  it('利用件数は商品編集権限がある場合だけ取得して商品台帳へ渡す', () => {
    expect(ledgerPage).toContain('const editor = canEditCatalog(actor.role)');
    expect(ledgerPage).toContain('editor ? getProductConfigurationUsageCounts() : Promise.resolve(null)');
    expect(ledgerPage).toContain('configurationUsageCounts={configurationUsageCounts}');
  });

  it('一覧・詳細の保存プラン件数をリンク化し、0件を「未使用」と誤表示しない', () => {
    expect(ledgerClient).toContain('data-testid="ledger-configuration-usage-link"');
    expect(ledgerClient).toContain('href={`/admin/configurations?option_id=${option.id}`}');
    expect(ledgerClient).toContain('href={`/admin/configurations?option_id=${selected.id}`}');
    expect(ledgerClient).toContain('pointer-events-auto relative z-30');
    expect(ledgerClient).toContain('onClick={(event) => event.stopPropagation()}');
    expect(ledgerClient).toContain('onKeyDown={(event) => event.stopPropagation()}');
    expect(ledgerClient).toContain('保存プラン0件');
    expect(ledgerClient).toContain('configurationUsageCounts[selected.id] ?? 0');
    expect(ledgerClient).toContain('label="保存プラン"');
    expect(ledgerClient).toContain('ここで「保存プラン」として数えるのは、configuration_items');
    expect(ledgerClient).toContain('標準見積・発行済み見積・Snapshotの履歴判定は含みません。');
  });

  it('指定商品で保存プランを直接参照するIDだけ取得し、重複する明細をSetで1件にまとめる', () => {
    expect(usage).toContain('export async function getProductConfigurationIdsForOption');
    expect(usage).toContain("db.configurationItems");
    expect(usage).toContain('row.option_id === optionId');
    expect(usage).toContain("db\n    .from('configuration_items')");
    expect(usage).toContain(".select('configuration_id')");
    expect(usage).toContain(".eq('option_id', optionId)");
    expect(usage).toContain('return new Set((data ?? []).map((row) => row.configuration_id))');
  });

  it('保存プランの既存一覧で対象商品の参照先だけ絞り込み、地域条件と共存させる', () => {
    expect(configurationsPage).toContain("await requireStaff('/admin/configurations')");
    expect(configurationsPage).toContain('getProductConfigurationIdsForOption(optionId)');
    expect(configurationsPage).toContain("typeof sp.option_id === 'string'");
    expect(configurationsPage).toContain('optionId === null');
    expect(configurationsPage).toContain('configurations.filter((configuration) => matchingIds.has(configuration.id))');
    expect(configurationsPage).toContain('const shown = optionConfigurations.filter');
    expect(configurationsPage).toContain('data-testid="configuration-option-filter"');
    expect(configurationsPage).toContain('total={optionConfigurations.length} matched={shown.length}');
    expect(configurationsPage).toContain('href="/admin/configurations"');
    expect(configurationsPage).toContain('href={`/admin/configurations/${c.id}`}');
    expect(regionFilter).toContain('new URLSearchParams(sp.toString())');
    expect(configurationDetail).toContain('await requireAdmin()');
  });

  it('完全削除可能の案内は未使用の下書きだけに表示する', () => {
    expect(ledgerClient).toContain("selected.status === 'draft' && selectedConfigurationUsageCount === 0");
    expect(ledgerClient).toContain('完全削除可能');
    expect(ledgerClient).toContain('一覧右端の「⋮」から直接削除できます。');
    expect(ledgerClient).toContain("selected.status === 'published'");
    expect(ledgerClient).toContain('登録済み・販売停止・廃番の商品は履歴を守るため、通常は完全削除せず商品状態で管理します。');
  });

  it('既存のサーバー側削除処理は保存済み構成からの参照を拒否する', () => {
    expect(supabaseStore).toContain("db.from('configuration_items').select('id', { count: 'exact', head: true }).eq('option_id', id)");
    expect(localStore).toContain('db.configurationItems.some((i) => i.option_id === id)');
    expect(supabaseStore).toContain('保存済みの仕様で使用されているため削除できません。非公開にしてください。');
    expect(localStore).toContain('保存済みの仕様で使用されているため削除できません。非公開にしてください。');
  });
});
