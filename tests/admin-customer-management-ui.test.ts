import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/customer-management/[id]/page.tsx'), 'utf8');
const existingUsers = fs.readFileSync(path.join(root, 'app/admin/customers/page.tsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const quotes = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');

describe('顧客管理UI', () => {
  it('keeps user and permission management separate from customer management', () => {
    expect(existingUsers).toContain('title="ユーザー・担当者"');
    expect(existingUsers).toContain('UserRoleForm');
    expect(existingUsers).not.toContain("from '@/lib/data/store'");
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

  it('keeps the customer list compact and explains the read-only access boundary', () => {
    for (const label of ['顧客名 / 法人名', '連絡先・住所', '進行中案件', '最近の案件', '顧客を見る']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('現在は参照専用です。');
    expect(list).toContain('本部は全顧客を参照し、総代理店・代理店は自分が担当する案件に関係する顧客だけを参照します。');
    expect(list).toContain('ここでは情報の編集・統合は行いません。');
    expect(list).toContain('顧客未紐付け案件');
    expect(list).toContain('data-testid="unlinked-customer-case-row"');
  });

  it('shows customer details, scoped cases, quotes, installation sites and honest future placeholders', () => {
    expect(detail).toContain('Profile（アカウント情報）');
    expect(detail).toContain('QuoteContact（最新案件受付情報）');
    expect(detail).toContain('総代理店・代理店には、自分が担当する案件系列に由来する情報だけを表示します。');
    for (const label of ['進行中案件', '過去案件', '見積履歴', '設置予定地', '契約・所有Wing・アフター']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('担当する案件系列のRevision履歴だけを表示します。');
    expect(detail).toContain('正式データモデル実装後');
    expect(detail).toContain('現在は正式データを表示しません。');
  });

  it('opens only quote revisions allowed by the scoped payload', () => {
    expect(detail).toContain('quote.can_open_quote ? (');
    expect(detail).toContain('href={`/admin/quotes/${encodeURIComponent(quote.id)}`}');
    expect(detail).toContain('履歴のみ');
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
