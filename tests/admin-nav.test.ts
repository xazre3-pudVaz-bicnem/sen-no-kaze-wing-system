import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdminNavSections } from '@/components/admin/admin-nav';

const labelsFor = (role: 'admin' | 'master_dealer' | 'dealer') => getAdminNavSections(role).map((section) => section.label);
const settingsPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/settings/page.tsx'), 'utf8');

describe('管理画面の業務領域ナビゲーション', () => {
  it('本部には4つの業務領域を表示する', () => {
    expect(labelsFor('admin')).toEqual(['案件管理', '商品台帳', '標準見積', '管理設定']);
  });

  it.each(['master_dealer', 'dealer'] as const)('%sには標準見積を表示しない', (role) => {
    expect(labelsFor(role)).toEqual(['案件管理', '商品台帳', '管理設定']);
  });

  it('問い合わせ受付は本部の案件管理に分類し、管理設定には含めない', () => {
    const sections = getAdminNavSections('admin');
    const caseItems = sections.find((section) => section.label === '案件管理')?.items.map((item) => item.label);
    const settingItems = sections.find((section) => section.label === '管理設定')?.items.map((item) => item.label);

    expect(caseItems).toContain('問い合わせ受付');
    expect(settingItems).not.toContain('問い合わせ受付');
    expect(settingItems).toEqual(['設定一覧', '操作マニュアル', 'ユーザー・担当者', '変更履歴']);
  });

  it('管理設定ランディングにお問い合わせカードを残さない', () => {
    expect(settingsPage).not.toContain('href="/admin/contacts"');
    for (const label of ['組織・代理店', 'ユーザー・担当者', '権限', '変更履歴', 'その他設定', '操作マニュアル']) {
      expect(settingsPage).toContain(label);
    }
  });

  it('管理設定の準備中項目を正式設定として誤表示しない', () => {
    expect(settingsPage).toContain('準備中');
    expect(settingsPage).toContain('正式な組織階層・地域権限の接続後に有効化します。');
    expect(settingsPage).toContain('正式な権限テンプレートとRLS／ACL接続後に有効化します。');
    expect(settingsPage).not.toContain('販売基準は「販売基準」から管理します。');
  });
});
