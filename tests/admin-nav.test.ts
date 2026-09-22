import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdminNavSections } from '@/components/admin/admin-nav';

const labelsFor = (role: 'admin' | 'master_dealer' | 'dealer') => getAdminNavSections(role).map((section) => section.label);
const settingsPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/settings/page.tsx'), 'utf8');

describe('管理画面の業務領域ナビゲーション', () => {
  it('本部には4つの業務領域を表示する', () => {
    expect(labelsFor('admin')).toEqual(['案件管理', '商品台帳', '販売基準', '管理設定']);
  });

  it.each(['master_dealer', 'dealer'] as const)('%sには販売基準を表示しない', (role) => {
    expect(labelsFor(role)).toEqual(['案件管理', '商品台帳', '管理設定']);
  });

  it('販売基準は本体マスターと標準見積を別メニューにせず一つの入口にする', () => {
    const sections = getAdminNavSections('admin');
    const salesBasis = sections.find((section) => section.label === '販売基準');
    expect(salesBasis?.href).toBe('/admin/base-masters');
    expect(salesBasis?.items).toEqual([]);
  });

  it('お問い合わせは本部の案件管理に分類し、管理設定には含めない', () => {
    const sections = getAdminNavSections('admin');
    const caseItems = sections.find((section) => section.label === '案件管理')?.items.map((item) => item.label);
    const settingItems = sections.find((section) => section.label === '管理設定')?.items.map((item) => item.label);

    expect(caseItems).toContain('お問い合わせ');
    expect(settingItems).not.toContain('お問い合わせ');
    expect(settingItems).toEqual(['設定一覧', '操作マニュアル', 'ユーザー・権限', '変更履歴']);
  });

  it('管理設定ランディングにお問い合わせカードを残さない', () => {
    expect(settingsPage).not.toContain('href="/admin/contacts"');
    for (const label of ['操作マニュアル', 'ユーザー・権限', '変更履歴']) {
      expect(settingsPage).toContain(label);
    }
  });
});
