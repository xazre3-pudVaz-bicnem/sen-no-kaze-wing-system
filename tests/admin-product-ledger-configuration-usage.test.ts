import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledgerPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const ledgerClient = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const usage = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/product-ledger-usage.ts'), 'utf8');
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

  it('一覧と詳細に未使用または構成で使用中の件数を表示する', () => {
    expect(ledgerClient).toContain("configurationUsageCount > 0 ? `構成で使用 ${configurationUsageCount}件` : '未使用'");
    expect(ledgerClient).toContain('configurationUsageCounts[selected.id] ?? 0');
    expect(ledgerClient).toContain('label="保存済み構成"');
    expect(ledgerClient).toContain('標準見積・発行済み見積・Snapshotの履歴判定は含みません。');
  });

  it('完全削除の導線は未使用の下書きだけに表示する', () => {
    expect(ledgerClient).toContain("selected.status === 'draft' && selectedConfigurationUsageCount === 0");
    expect(ledgerClient).toContain('完全削除可能');
    expect(ledgerClient).toContain('一覧の「その他の操作」から直接削除できます。');
    expect(ledgerClient).toContain('保存済み構成で使用されているため、この下書きは完全削除できません。');
    expect(ledgerClient).toContain('登録済み商品は完全削除の対象にしません。');
  });

  it('既存のサーバー側削除処理は保存済み構成からの参照を拒否する', () => {
    expect(supabaseStore).toContain("db.from('configuration_items').select('id', { count: 'exact', head: true }).eq('option_id', id)");
    expect(localStore).toContain('db.configurationItems.some((i) => i.option_id === id)');
    expect(supabaseStore).toContain('保存済みの仕様で使用されているため削除できません。非公開にしてください。');
    expect(localStore).toContain('保存済みの仕様で使用されているため削除できません。非公開にしてください。');
  });
});
