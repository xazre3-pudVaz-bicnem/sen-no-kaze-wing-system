import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const refinement = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-step2-refinements.tsx'),
  'utf8'
);
const adminLayout = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');

describe('商品登録 STEP2 の確認画面', () => {
  it('STEP1へ戻る導線と表示確認だけであることを明確にする', () => {
    expect(refinement).toContain('STEP1 商品情報に戻る');
    expect(refinement).toContain('表示確認のみです。ここで仕様を選択しても、下書きの登録内容は変更されません。');
    expect(refinement).toContain('変更する場合はSTEP1へ戻ってください。');
  });

  it('登録直前に画像・価格・お客様選択を1か所で確認する', () => {
    expect(refinement).toContain('登録前の最終チェック');
    expect(refinement).toContain("'メイン画像'");
    expect(refinement).toContain('未登録（STEP1で登録してください）');
    expect(refinement).toContain("'価格'");
    expect(refinement).toContain('0円の確認が必要');
    expect(refinement).toContain("'お客様選択'");
    expect(refinement).toContain('お客様表示を確認してください');
  });

  it('既存の公開処理は変更せず、STEP2の表示補助だけを管理画面へ組み込む', () => {
    expect(adminLayout).toContain("import { ProductRegistrationStep2Refinements }");
    expect(adminLayout).toContain('<ProductRegistrationStep2Refinements />');
    expect(refinement).not.toContain('publishOptionAction');
  });

  it('DOM補助処理自身の変更でMutationObserverが再帰し続けない', () => {
    expect(refinement).toContain('observer.disconnect();');
    expect(refinement).toContain("observer.observe(document.body, { childList: true, subtree: true });");
    expect(refinement).toContain('if (element && element.textContent !== value) element.textContent = value');
  });
});
