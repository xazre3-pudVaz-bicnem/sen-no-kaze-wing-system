import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'), 'utf8');
const newPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'), 'utf8');
const flow = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/registered-option-edit-flow.tsx'), 'utf8');

describe('登録済み商品の変更確認フロー', () => {
  it('登録済み商品を初回登録のSTEPフローから分離する', () => {
    expect(page).toContain("if (option.status === 'published')");
    expect(page).toContain('<RegisteredOptionEditFlow');
    expect(page.indexOf("if (option.status === 'published')")).toBeLessThan(page.indexOf('<OptionRegistrationSaveBoundary>'));
    expect(flow).toContain('商品を編集');
    expect(flow).toContain('変更内容確認');
    expect(flow).not.toContain('商品登録の流れ');
    expect(flow).toContain('name="status" value="published"');
    expect(flow).not.toContain('<option value="draft">');
    expect(flow).not.toContain('変更内容を自動保存しました。');
  });

  it('確認前はブラウザ内のFormDataだけに保持し、反映ボタンで既存保存Actionを呼ぶ', () => {
    expect(flow).toContain("const data = new FormData(form)");
    expect(flow).toContain("setScreen('review')");
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
    expect(flow).toContain('この変更を反映');
    expect(flow).toContain('「この変更を反映」を押すまで、登録済みの商品情報には反映されません。');
    expect(flow).toContain('name="status" value="published"');
  });

  it('変更項目だけを変更前・変更後で比較し、長文と画像は現在内容との比較にする', () => {
    expect(flow).toContain("row.before !== row.after");
    expect(flow).toContain('変更前');
    expect(flow).toContain('変更後');
    expect(flow).toContain('現在の内容');
    expect(flow).toContain('変更後の内容');
    expect(flow).toContain("kind: 'long'");
    expect(flow).toContain("kind: 'image'");
    expect(flow).toContain('メイン画像');
    expect(flow).toContain('商品説明');
  });

  it('変更後のお客様表示プレビューと編集への戻り導線を持ち、戻っても入力フォームを破棄しない', () => {
    expect(flow).toContain('変更後のお客様表示プレビュー');
    expect(flow).toContain('<OptionCustomerPreview');
    expect(flow).toContain('option={review.option}');
    expect(flow).toContain('編集に戻る');
    expect(flow).toContain("hidden={screen !== 'review'}");
    expect(flow).toContain("hidden={screen !== 'edit'}");
    expect(flow).not.toContain("if (screen === 'review' && review)");
  });

  it('別保存の資料・お客様選択は仮実装せず接続待ちにする', () => {
    expect(flow).toContain('registered-option-pending-subedit');
    expect(flow).toContain('サブ画像・メーカーPDF・お客様が選ぶ仕様');
    expect(flow).toContain('変更確認フローへの接続待ち');
    expect(flow).not.toContain('OptionMediaManager');
    expect(flow).not.toContain('OptionVariantManager');
  });

  it('登録済み商品の通常価格0円への変更は既存サーバールール接続待ちとして反映を止める', () => {
    expect(flow).toContain('introducesUnconfirmedZeroPrice');
    expect(flow).toContain('zeroPriceNeedsServerContract');
    expect(flow).toContain('現在のサーバー側ルールとの接続待ち');
  });

  it('初回登録はSTEP1→STEP2→この内容で登録を維持する', () => {
    expect(page).toContain('STEP 1 商品情報');
    expect(page).toContain('STEP 2 登録内容確認');
    expect(page).toContain('この内容で登録');
    expect(newPage).toContain('商品登録の2ステップ');
    expect(newPage).toContain('この内容で登録');
  });
});