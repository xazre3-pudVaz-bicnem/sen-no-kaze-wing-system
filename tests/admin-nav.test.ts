import { describe, expect, it } from 'vitest';
import { getAdminNavSections } from '@/components/admin/admin-nav';

const labelsFor = (role: 'admin' | 'master_dealer' | 'dealer') => getAdminNavSections(role).map((section) => section.label);

describe('管理画面の業務領域ナビゲーション', () => {
  it('本部には4つの業務領域を表示する', () => {
    expect(labelsFor('admin')).toEqual(['案件管理', '商品台帳', '販売基準', '管理設定']);
  });

  it.each(['master_dealer', 'dealer'] as const)('%sには販売基準を表示しない', (role) => {
    expect(labelsFor(role)).toEqual(['案件管理', '商品台帳', '管理設定']);
  });
});
