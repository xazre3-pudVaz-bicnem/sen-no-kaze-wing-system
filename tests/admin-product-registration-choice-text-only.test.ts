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
    expect(manager).toContain("{firstChoice ? '最初の選択肢を追加' : '＋ 選択肢を追加'}");
    expect(manager).toContain('open={firstChoice}');
  });

  it('選択肢画像の新規登録UIを出さず、既存画像URLは保存時に保持する', () => {
    expect(manager).not.toContain('name="image_file"');
    expect(manager).not.toContain('SmartImage');
    expect(manager).not.toContain('画像・表示などの詳細設定');
    expect(manager).toContain('name="image_url" value={choice?.image_url ?? \'\'}');
    expect(manager).toContain('表示などの詳細設定');
  });
});
