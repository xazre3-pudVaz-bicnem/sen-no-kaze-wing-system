import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/demo/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/customer-management/demo/[id]/page.tsx'), 'utf8');
const data = fs.readFileSync(path.join(root, 'lib/demo/customer-management.ts'), 'utf8');

describe('顧客管理サンプル画面', () => {
  it('uses static fake data only and never reads or writes the production store', () => {
    expect(list).toContain("const actor = await requireStaff('/admin/customer-management/demo')");
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

  it('matches the actual customer-list structure without exposing email or customer address in the list', () => {
    for (const label of [
      '顧客',
      '進行中案件',
      '最近の案件',
      '商品モデル / 設置予定地',
      '最終更新日',
      '顧客を見る',
    ]) {
      expect(list).toContain(label);
    }
    expect(list).toContain("顧客番号 {customer.customer_no ?? '未登録'}");
    expect(list).toContain("電話：{customer.phone ?? '未登録'}");
    expect(list).not.toContain('<span className="block">{customer.email}</span>');
    expect(list).not.toContain("{customer.address ?? '住所未登録'}");
  });

  it('shows the dealer column for admin and master dealer only', () => {
    expect(list).toContain("const showDealerColumn = actor.role === 'admin' || actor.role === 'master_dealer';");
    expect(list).toContain('{showDealerColumn && <Th>担当代理店</Th>}');
    expect(list).toContain("{recent?.dealer_name ?? '未割り当て'}");
    expect(list).toContain('<Td colSpan={showDealerColumn ? 7 : 6}');
  });

  it('links the recent sample case only inside the demo customer area', () => {
    expect(list).toContain('function demoCaseHref(customerId: string): string');
    expect(list).toContain('href={demoCaseHref(customer.id)}');
    expect(list).not.toContain('href={`/admin/quotes/');
    expect(list).not.toContain('href="/admin/quotes"');
  });

  it('shows the main customer detail sections without linking fake IDs into real case pages', () => {
    for (const label of [
      '現在の顧客情報',
      '最新案件受付情報',
      '進行中案件',
      '過去案件',
      '見積履歴',
      '設置予定地',
      '契約・所有Wing・アフター',
    ]) {
      expect(detail).toContain(label);
    }
    expect(detail).not.toContain('Profile（アカウント情報）');
    expect(detail).not.toContain('QuoteContact（最新案件受付情報）');
    expect(detail).toContain('案件を見る（デモ）');
    expect(detail).toContain('見積書を見る（デモ）');
    expect(detail).not.toContain('href={`/admin/quotes/');
    expect(detail).not.toContain('href="/admin/quotes"');
    expect(detail).toContain('サンプル顧客一覧へ戻る');
  });

  it('keeps the demo tables compact while preserving the same information', () => {
    expect(list).toContain("<Table minWidth={showDealerColumn ? '60rem' : '52rem'}>");
    expect(list).toContain('<Table minWidth="44rem">');
    expect(detail).toContain('<Table minWidth="46rem">');
    expect(detail).toContain('<Th>案件 / 商品モデル</Th>');
    expect(detail).toContain('<Th>見積番号 / 商品モデル</Th>');
  });
});
