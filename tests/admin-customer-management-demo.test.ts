import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/demo/page.tsx'), 'utf8');
const listUi = fs.readFileSync(path.join(root, 'components/admin/customer-management-list.tsx'), 'utf8');
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

  it('reuses the same compact filtered customer-list UI as the actual screen', () => {
    expect(list).toContain('<CustomerManagementList');
    expect(list).toContain('customers={DEMO_CUSTOMERS}');
    expect(list).toContain('basePath="/admin/customer-management/demo"');
    expect(list).toContain('demo');
    for (const label of ['顧客', '案件', '最近の設置予定地', '代理店 / 担当者', '最終更新', '詳細']) {
      expect(listUi).toContain(label);
    }
    expect(listUi).toContain("顧客番号 {customer.customer_no ?? '未登録'}");
    expect(listUi).toContain("電話：{customer.phone ?? '未登録'}");
    expect(listUi).not.toContain("{customer.email || 'メール未登録'}");
    expect(listUi).not.toContain("{customer.address ?? '住所未登録'}");
  });

  it('uses sample dealer-company data to preview the intended final dealer display', () => {
    expect(data).toContain("dealer_company: 'サンプル代理店株式会社'");
    expect(data).toContain("dealer_company: 'サンプル建築販売'");
    expect(list).toContain('DEMO_CUSTOMER_DETAILS');
    expect(list).toContain('const dealerCompanyByCustomerId = Object.fromEntries(');
    expect(list).toContain('dealerCompanyByCustomerId={dealerCompanyByCustomerId}');
    expect(listUi).toContain('const dealerCompany = dealerCompanyByCustomerId?.[customer.id] ?? null;');
    expect(listUi).toContain('{dealerCompany && <p className="font-semibold text-ink">{dealerCompany}</p>}');
  });

  it('keeps the dealer column role-scoped in the demo too', () => {
    expect(list).toContain("const showDealerColumn = actor.role === 'admin' || actor.role === 'master_dealer';");
    expect(list).toContain('showDealerColumn={showDealerColumn}');
    expect(listUi).toContain('colSpan={showDealerColumn ? 6 : 5}');
  });

  it('does not send sample case numbers to customer detail or real case pages', () => {
    expect(listUi).toContain('const caseHref = recent && !demo ? liveCaseHref(recent) : null;');
    expect(listUi).toContain("title={demo ? 'サンプル画面では案件詳細へ遷移しません' : undefined}");
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

  it('matches the compact real detail layout and keeps future sections visible for design review', () => {
    expect(detail).toContain('<Table minWidth="40rem">');
    expect(detail).toContain('<Th>案件</Th>');
    expect(detail).not.toContain('<Th>状態</Th>');
    expect(detail).toContain("{customerCase.dealer_company ?? '代理店名未登録'}");
    expect(detail).toContain('担当：{customerCase.dealer_name}');
    expect(detail).toContain('<Table minWidth="34rem">');
    expect(detail).toContain('<Th>見積</Th>');
    expect(detail).not.toContain('<Th>版</Th>');
    expect(detail).toContain('第{quote.revision}版');
    expect(detail).toContain('customer-demo-future-sections');
  });
});
