import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const manager = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);

describe('商品登録 お客様選択の簡潔化', () => {
  it('選択項目は1つの入口から部位名で追加する', () => {
    expect(manager).toContain('お客様選択');
    expect(manager).toContain('＋ 選択項目を追加');
    expect(manager).toContain('例：床／カウンター／アクセントパネル／浴槽');
    expect(manager).not.toContain("const QUICK_GROUPS = ['カラー', '柄', 'サイズ']");
  });

  it('選択項目を作成した直後は最初の選択肢入力を開いて案内する', () => {
    expect(manager).toContain('const firstChoice = groupChoices.length === 0');
    expect(manager).toContain("{firstChoice ? '最初の選択肢を追加（追加金額も入力）' : '＋ 選択肢を追加（追加金額も入力）'}");
    expect(manager).toContain('open={firstChoice}');
  });

  it('色見本画像は任意で登録でき、既存URLの保持・解除を選べる', () => {
    expect(manager).toContain('name="image_file"');
    expect(manager).toContain('accept="image/jpeg,image/png,image/webp,image/avif"');
    expect(manager).toContain('<SmartImage');
    expect(manager).toContain('value={imageUrl}');
    expect(manager).toContain('画像は任意');
    expect(manager).toContain('解除');
    expect(manager).toContain('元に戻す');
    expect(manager).toContain('表示などの詳細設定');
  });
});
