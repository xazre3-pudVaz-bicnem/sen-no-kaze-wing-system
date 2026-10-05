import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/page.tsx'), 'utf8');
const listUi = fs.readFileSync(path.join(root, 'components/admin/customer-management-list.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/customer-management/[id]/page.tsx'), 'utf8');
const existingUsers = fs.readFileSync(path.join(root, 'app/admin/customers/page.tsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const quotes = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');

describe('顧客管理UI', () => {
  it('keeps user and permission management separate from customer management', () => {
    expect(existingUsers).toContain('title="ユーザー・担当者"');
    expect(existingUsers).toContain('UserRoleForm');
    expect(existingUsers).not.toContain("from '@/lib/domain/customer-management'");
    expect(list).toContain('title="顧客管理"');
    expect(list).toContain("await requireStaff('/admin/customer-management')");
    expect(detail).toContain("await requireStaff('/admin/customer-management')");
  });

  it('loads customer management only through the access-scoped store contract', () => {
    expect(list).toContain('store.listAccessibleCustomers(actor)');
    expect(detail).toContain('store.getAccessibleCustomerDetail(id, actor)');
    for (const broadCall of [
      'store.listProfiles()',
      'store.listAllQuotes()',
      'store.listQuoteRequests()',
      'store.listAllConfigurations()',
    ]) {
      expect(list).not.toContain(broadCall);
      expect(detail).not.toContain(broadCall);
    }
  });

  it('uses the shared compact customer list for identity, case context, and detail navigation', () => {
    expect(list).toContain('<CustomerManagementList');
    for (const label of ['顧客', '案件', '最近の設置予定地', '最終更新', '詳細']) {
      expect(listUi).toContain(label);
    }
    expect(listUi).toContain("顧客番号 {customer.customer_no ?? '未登録'}");
    expect(listUi).toContain("電話：{customer.phone ?? '未登録'}");
    expect(listUi).not.toContain("{customer.email || 'メール未登録'}");
    expect(listUi).not.toContain("{customer.address ?? '住所未登録'}");
    expect(list).toContain('現在は参照専用です。');
    expect(list).toContain('今回は閲覧範囲を変更せず');
    expect(list).toContain('ここでは情報の編集・統合も行いません。');
    expect(list).toContain('顧客未紐付け案件');
    expect(list).toContain('data-testid="unlinked-customer-case-row"');
  });

  it('keeps the dealer column role-scoped and ready for dealer-company display without widening customer access', () => {
    expect(list).toContain("const showDealerColumn = actor.role === 'admin' || actor.role === 'master_dealer';");
    expect(list).toContain('showDealerColumn={showDealerColumn}');
    expect(listUi).toContain('{showDealerColumn && (');
    expect(listUi).toContain('代理店 / 担当者');
    expect(listUi).toContain('dealerCompanyByCustomerId?: Record<string, string | null | undefined>');
    expect(listUi).toContain('const dealerCompany = dealerCompanyByCustomerId?.[customer.id] ?? null;');
    expect(listUi).toContain("{recent?.dealer_name ?? '担当者未割り当て'}");
    expect(listUi).toContain('colSpan={showDealerColumn ? 6 : 5}');
  });

  it('provides Excel-like per-column filtering and sorting while retaining global search', () => {
    expect(listUi).toContain('列見出しの▼から、Excelのように絞り込み・並び替えができます。');
    expect(listUi).toContain('顧客名・法人名・電話番号・案件情報で検索');
    for (const field of ['name="customer"', 'name="case_q"', 'name="case"', 'name="site"', 'name="dealer"', 'name="from"', 'name="to"']) {
      expect(listUi).toContain(field);
    }
    for (const sort of ['customer_asc', 'cases_desc', 'case_asc', 'site_asc', 'dealer_asc', 'updated_desc']) {
      expect(listUi).toContain(sort);
    }
    expect(listUi).toContain('絞り込み・並び替えを解除');
    expect(listUi).toContain('filterAndSortCustomers(customers, filters)');
  });

  it('fits the main list to ordinary desktop widths and only keeps mobile horizontal fallback', () => {
    expect(listUi).toContain('min-w-[40rem] table-fixed text-sm md:min-w-0');
    expect(listUi).toContain('overflow-x-auto md:overflow-visible');
    expect(listUi).not.toContain("'60rem'");
    expect(listUi).not.toContain("'52rem'");
    expect(listUi).toContain("<col style={{ width: '8%' }} />");
    expect(list).toContain('<Table minWidth="44rem">');
  });

  it('shows an explicit DB-update waiting state instead of a false empty list or 500 error', () => {
    expect(store).toContain("availability: 'available' | 'migration_pending'");
    expect(supabaseStore).toContain("isMissingNamedFunction(error, 'list_accessible_customers')");
    expect(supabaseStore).toContain("isMissingNamedFunction(error, 'get_accessible_customer_detail')");
    expect(supabaseStore).toContain("availability: 'migration_pending'");
    expect(localStore).toContain("availability: 'available'");
    expect(list).toContain("view.availability === 'migration_pending'");
    expect(list).toContain('顧客が0件なのではなく');
    expect(list).toContain('data-testid="customer-management-migration-pending"');
    expect(list).toContain('href="/admin/customer-management/demo"');
    expect(list).toContain('サンプル画面を確認');
    expect(detail).toContain("detailResult.availability === 'migration_pending'");
    expect(detail).toContain('顧客が存在しないという意味ではありません。');
    expect(detail).toContain('data-testid="customer-detail-migration-pending"');
  });

  it('shows current customer information separately from formal quote history', () => {
    expect(detail).toContain('現在の顧客情報');
    expect(detail).toContain('最新案件受付情報');
    expect(detail).not.toContain('Profile（アカウント情報）');
    expect(detail).not.toContain('QuoteContact（最新案件受付情報）');
    expect(detail).toContain('この画面は現在の顧客情報を確認する場所です。');
    expect(detail).toContain('現在の顧客情報が変わってもこの画面から過去の見積内容を書き換えません。');
    expect(detail).toContain('総代理店・代理店には、自分が担当する案件系列に由来する情報だけを表示します。');
    for (const label of ['進行中案件', '過去案件', '見積履歴', '設置予定地', '契約・所有Wing・アフター']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('正式見積の改訂履歴を確認する領域です。');
    expect(detail).toContain('現在の顧客情報には自動追従させません。');
    expect(detail).toContain('正式データモデル実装後');
    expect(detail).toContain('現在は正式データを表示しません。');
  });

  it('opens only quote revisions allowed by the scoped payload', () => {
    expect(detail).toContain('quote.can_open_quote ? (');
    expect(detail).toContain('href={`/admin/quotes/${encodeURIComponent(quote.id)}`}');
    expect(detail).toContain('見積書を見る');
    expect(detail).toContain('履歴のみ');
  });

  it('keeps detail tables unchanged for the separate detail-screen follow-up', () => {
    expect(detail).toContain('<Table minWidth="46rem">');
    expect(detail).toContain('<Th>案件 / 商品モデル</Th>');
    expect(detail).toContain('<Th>見積番号 / 商品モデル</Th>');
  });

  it('shows the latest quote status before the request status', () => {
    const quoteCheck = detail.indexOf('if (customerCase.latest_quote) return QUOTE_STATUS_LABELS[customerCase.latest_quote.status];');
    const requestCheck = detail.indexOf('if (customerCase.request_status) return QUOTE_REQUEST_STATUS_LABELS[customerCase.request_status];');
    expect(quoteCheck).toBeGreaterThan(-1);
    expect(requestCheck).toBeGreaterThan(quoteCheck);
  });

  it('keeps customer management as a case-management utility without crowding the case heading', () => {
    expect(nav).toContain("href: '/admin/customer-management'");
    expect(nav).toContain("label: '顧客管理'");
    expect(quotes).not.toContain('href="/admin/customer-management"');
    expect(quotes).not.toContain('>顧客管理<');
  });
});
