import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const priceSync = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-price-ui-sync.tsx'),
  'utf8'
);
const saveBoundary = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-save-boundary.tsx'),
  'utf8'
);
const forms = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/forms.tsx'), 'utf8');

describe('商品登録の商品価格入力', () => {
  it('商品価格を1円単位で入力できるようにする', () => {
    expect(forms).toContain('data-testid="option-price"');
    expect(priceSync).toContain("priceInput.step = '1';");
  });

  it('価格入力と別途見積の変更に合わせて0円警告を即時同期する', () => {
    expect(priceSync).toContain('商品標準原価が0円です。正式な0円の場合はSTEP 2で確認が必要です');
    expect(priceSync).toContain("priceInput.addEventListener('input', sync);");
    expect(priceSync).toContain("priceOnRequest?.addEventListener('change', sync);");
    expect(priceSync).toContain("badge.textContent = '基本チェックOK';");
  });

  it('商品登録の保存境界で価格UI同期を有効にする', () => {
    expect(saveBoundary).toContain("import { OptionRegistrationPriceUiSync } from '@/components/admin/option-registration-price-ui-sync';");
    expect(saveBoundary).toContain('<OptionRegistrationPriceUiSync />');
  });
});
