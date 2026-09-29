import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/demo/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/customer-management/demo/[id]/page.tsx'), 'utf8');
const data = fs.readFileSync(path.join(root, 'lib/demo/customer-management.ts'), 'utf8');

describe('顧客管理サンプル画面', () => {
  it('uses static fake data only and never reads or writes the production store', () => {
    expect(list).toContain("await requireStaff('/admin/customer-management/demo')");
    expect(detail).toContain("await requireStaff('/admin/customer-management/demo')");
    expect(list).not.toContain('getStore(');
    expect(detail).not.toContain('getStore(');
    expect(data).not.toContain('getStore(');
    expect(data).not.toContain('Supabase');
    expect(list).toContain('本番DBには保存されず');
    expect(detail).toContain('本番DBには保存されず');
  });

  it('shows three distinct sample customer states plus an unlinked case', () => {
    for (const customer of ['山田 太郎', '佐藤 花子', '鈴木 一郎']) {
      expect(data).toContain(customer);
    }
    expect(data).toContain('DEMO-0001');
    expect(data).toContain('W-DEMO-0001');
    expect(data).toContain('B-DEMO-0012');
    expect(data).toContain("identity_issue: 'missing_profile'");
    expect(list).toContain('顧客未紐付け案件');
  });

  it('keeps the list close to the actual customer-management information layout', () => {
    for (const label of ['顧客名 / 法人名', '連絡先・住所', '進行中案件', '最近の案件', '顧客を見る']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('DEMO_CUSTOMERS');
    expect(list).toContain('/admin/customer-management/demo/');
    expect(list).toContain('サンプル顧客');
  });

  it('shows the main customer detail sections without linking fake IDs into real case pages', () => {
    for (const label of [
      'Profile（アカウント情報）',
      'QuoteContact（最新案件受付情報）',
      '進行中案件',
      '過去案件',
      '見積履歴',
      '設置予定地',
      '契約・所有Wing・アフター',
    ]) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('案件を見る（デモ）');
    expect(detail).not.toContain('href={`/admin/quotes/');
    expect(detail).not.toContain('href="/admin/quotes"');
    expect(detail).toContain('サンプル顧客一覧へ戻る');
  });
});
