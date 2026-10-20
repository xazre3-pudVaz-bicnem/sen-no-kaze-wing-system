import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const preview = fs.readFileSync(path.join(root, 'components/admin/option-customer-preview.tsx'), 'utf8');
const finalEnhancer = fs.readFileSync(
  path.join(root, 'components/admin/option-registration-final-ui-enhancer.tsx'),
  'utf8'
);
const saveBoundary = fs.readFileSync(
  path.join(root, 'components/admin/option-registration-save-boundary.tsx'),
  'utf8'
);

describe('商品登録UIの最終整理', () => {
  it('STEP2の商品プレビューから内部実装の説明を画面表示として外す', () => {
    expect(preview).not.toContain('<p className="mt-2 text-xs leading-5 text-muted">');
    expect(preview).not.toContain('商品追加額・仕様追加額・合計追加額');
  });

  it('メイン画像URL欄は初期状態から常に表示する', () => {
    expect(finalEnhancer).toContain("input[name=\"image_url\"]");
    expect(finalEnhancer).toContain("wrapper.style.removeProperty('display')");
    expect(finalEnhancer).not.toContain("wrapper.style.display = open ? '' : 'none'");
    expect(finalEnhancer).not.toContain('URLで画像を指定');
  });

  it('重複する現在STEP表示と空状態の説明を簡略化する', () => {
    expect(finalEnhancer).toContain("startsWith('現在：STEP')");
    expect(finalEnhancer).toContain('現在、選択項目はありません。');
  });

  it('STEP2の案内と0円・選択項目表示を簡潔にする', () => {
    expect(finalEnhancer).toContain('お客様に表示される商品内容を確認します。');
    expect(finalEnhancer).toContain('登録内容を変更する場合はSTEP 1へ戻ってください。');
    expect(finalEnhancer).toContain("text === '0円の確認が必要'");
    expect(finalEnhancer).toContain("setTextIfChanged(row, '0円')");
    expect(finalEnhancer).toContain("text === '選択項目なし'");
  });

  it('登録画面の保存境界で最終UI整理を有効化する', () => {
    expect(saveBoundary).toContain('OptionRegistrationFinalUiEnhancer');
    expect(saveBoundary).toContain('<OptionRegistrationFinalUiEnhancer />');
  });
});
