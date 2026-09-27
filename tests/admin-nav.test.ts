import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdminNavSections } from '@/components/admin/admin-nav';

const labelsFor = (role: 'admin' | 'master_dealer' | 'dealer') => getAdminNavSections(role).map((section) => section.label);
const settingsPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/settings/page.tsx'), 'utf8');
const navSource = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'), 'utf8');

describe('管理画面の業務領域ナビゲーション', () => {
  it('本部には4つの業務領域だけを表示する', () => {
    expect(labelsFor('admin')).toEqual(['案件管理', '商品台帳', '標準見積', '管理設定']);
  });

  it.each(['master_dealer', 'dealer'] as const)('%sには標準見積を表示しない', (role) => {
    expect(labelsFor(role)).toEqual(['案件管理', '商品台帳', '管理設定']);
  });

  it('補助画面は大分類のactive判定にだけ含め、二段目メニューを描画しない', () => {
    const sections = getAdminNavSections('admin');
    const cases = sections.find((section) => section.label === '案件管理');
    const ledger = sections.find((section) => section.label === '商品台帳');
    const estimates = sections.find((section) => section.label === '標準見積');

    expect(cases?.match).toEqual(expect.arrayContaining([
      '/admin/quotes',
      '/admin/configurations',
      '/admin/contacts',
      '/admin/notifications',
      '/admin/customer-management',
    ]));
    expect(ledger?.match).toEqual(expect.arrayContaining([
      '/admin/ledger',
      '/admin/free-products',
      '/admin/models',
      '/admin/categories',
      '/admin/options',
      '/admin/import',
      '/admin/preview-rules',
    ]));
    expect(estimates?.match).toEqual(expect.arrayContaining([
      '/admin/base-masters',
      '/admin/estimate-templates',
      '/admin/base-breakdown',
    ]));

    expect(navSource).not.toContain('activeSection.items.map');
    expect(navSource).not.toContain("label: '案件一覧'");
    expect(navSource).not.toContain("label: '旧 標準見積Excel'");
    expect(navSource).not.toContain("label: '商品登録・編集'");
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
