import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);
const enhancer = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-ui-enhancer.tsx'),
  'utf8'
);

describe('商品登録のお客様選択・価格対象モデルの簡潔UI', () => {
  it('お客様選択はよく使う項目から始め、選択肢の詳細を折り畳む', () => {
    expect(variants).toContain("const QUICK_GROUPS = ['カラー', '柄', 'サイズ']");
    expect(variants).toContain('＋ その他');
    expect(variants).toContain('お客様が選ぶ内容');
    expect(variants).toContain('選択肢名');
    expect(variants).toContain('＋ 選択肢を追加');
    expect(variants).toContain('画像・表示などの詳細設定');
    expect(variants).toContain('標準の選択肢にする');
  });

  it('対象モデルは全モデル共通とモデル指定を明示し、元の保存フィールドへ同期する', () => {
    expect(enhancer).toContain("select[name=\"base_model_id\"]");
    expect(enhancer).toContain("createChoice('全モデル共通', 'all')");
    expect(enhancer).toContain("createChoice('モデルを指定', 'specific')");
    expect(enhancer).toContain("setNativeSelectValue(original, '')");
    expect(enhancer).toContain('モデルを選択してください');
  });

  it('価格・公開状態の補足を短くし、下書きは読み取り表示へ変える', () => {
    expect(enhancer).toContain('価格と対象モデルを設定します。公開はSTEP 2で行います。');
    expect(enhancer).toContain('0円のまま下書き保存できます。公開時に0円でよいか確認します。');
    expect(enhancer).toContain("input[name=\"status\"][value=\"draft\"]");
    expect(enhancer).toContain("badge.textContent = '下書き'");
    expect(enhancer).toContain('公開はSTEP 2の確認画面から行います。');
  });
});
