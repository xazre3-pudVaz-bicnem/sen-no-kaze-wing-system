import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const list = fs.readFileSync(path.join(root, 'app/admin/customer-management/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/customer-management/[id]/page.tsx'), 'utf8');
const existingUsers = fs.readFileSync(path.join(root, 'app/admin/customers/page.tsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');

describe('顧客管理UI', () => {
  it('keeps user and permission management separate from customer management', () => {
    expect(existingUsers).toContain('title="ユーザー・担当者"');
    expect(existingUsers).toContain('UserRoleForm');
    expect(existingUsers).not.toContain("from '@/lib/domain/customer-management'");
    expect(list).toContain('title="顧客管理"');
    expect(list).toContain("await requireAdmin('/admin/customer-management')");
  });

  it('shows the requested customer list without treating profile as a formal customer master', () => {
    for (const label of ['顧客名 / 法人名', '連絡先', '住所', '進行中案件', '最近の案件', '担当代理店', '顧客を見る']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('Profile と案件受付時の QuoteContact は別情報として扱い');
    expect(list).toContain('氏名やメールアドレスだけで別データを自動統合することもありません。');
    expect(list).toContain('顧客未紐付け案件');
    expect(list).toContain('既存 user_id だけでは実顧客のidentityを確定できない案件');
    expect(list).toContain('data-testid="unlinked-customer-case-row"');
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

  it('does not add customer management to shared navigation in this PR', () => {
    expect(nav).not.toContain('/admin/customer-management');
  });
});
