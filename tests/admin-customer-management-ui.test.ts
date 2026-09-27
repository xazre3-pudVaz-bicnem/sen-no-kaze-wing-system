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
    expect(existingUsers).not.toContain("from '@/lib/domain/customer-management'");
    expect(list).toContain('title="顧客管理"');
    expect(list).toContain("await requireAdmin('/admin/customer-management')");
  });

  it('keeps the customer list compact and explains the read-only identity boundary in business language', () => {
    for (const label of ['顧客名 / 法人名', '連絡先・住所', '進行中案件', '最近の案件', '顧客を見る']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('現在は参照専用です。');
    expect(list).toContain('ここでは情報の編集・統合は行いません。');
    expect(list).toContain('同姓同名やメールアドレスの一致だけで、自動的に同じ顧客としてまとめることもありません。');
    expect(list).toContain('顧客未紐付け案件');
    expect(list).toContain('顧客アカウントとの紐付けを確認できていない案件です。');
    expect(list).toContain('確認が必要な理由');
    expect(list).toContain('data-testid="unlinked-customer-case-row"');
    expect(list).not.toContain('既存 user_id だけでは実顧客のidentityを確定できない案件');
  });

  it('shows customer details, cases, quotes, installation sites and honest future placeholders', () => {
    expect(detail).toContain('Profile（アカウント情報）');
    expect(detail).toContain('QuoteContact（最新案件受付情報）');
    expect(detail).toContain('顧客情報の正本は未確定です。');
    for (const label of ['進行中案件', '過去案件', '見積履歴', '設置予定地', '契約・所有Wing・アフター']) {
      expect(detail).toContain(label);
    }
    for (const label of ['契約', '所有中Wing', 'アフター', '準備中']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('正式データモデル実装後');
    expect(detail).toContain('現在は正式データを表示しません。');
  });

  it('opens every quote revision through its direct detail route', () => {
    expect(detail).toContain('href={`/admin/quotes/${encodeURIComponent(quote.id)}`}');
    expect(detail).not.toContain('href={`/admin/quotes?case=${encodeURIComponent(quote.id)}#case-workspace`}');
  });

  it('shows the latest quote status before the request status', () => {
    const quoteCheck = detail.indexOf('if (customerCase.latestQuote) return QUOTE_STATUS_LABELS[customerCase.latestQuote.status];');
    const requestCheck = detail.indexOf('if (customerCase.request) return QUOTE_REQUEST_STATUS_LABELS[customerCase.request.status];');
    expect(quoteCheck).toBeGreaterThan(-1);
    expect(requestCheck).toBeGreaterThan(quoteCheck);
  });

  it('keeps customer management as a case-management utility instead of a second-level menu', () => {
    expect(nav).toContain('/admin/customer-management');
    expect(quotes).toContain('href="/admin/customer-management"');
    expect(quotes).toContain('顧客管理');
    expect(nav).not.toContain("label: '顧客管理'");
  });
});
