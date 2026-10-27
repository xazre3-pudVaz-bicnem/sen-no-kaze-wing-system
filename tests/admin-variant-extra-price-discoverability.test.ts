import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const choices = read('components/admin/option-variant-manager.tsx');
const action = read('lib/actions/admin.ts');
const registered = read('components/admin/registered-option-edit-flow.tsx');

describe('お客様選択：選択肢ごとの追加金額入力の見える化', () => {
  it('選択項目を作った後に選択肢ごとに金額を入力する順序を案内する', () => {
    expect(choices).toContain('① 選択項目');
    expect(choices).toContain('② 選択肢');
    expect(choices).toContain('③ 各選択肢の原価差額');
    expect(choices).toContain('最初の選択肢を追加（原価差額も入力）');
    expect(choices).toContain('選択肢を追加（原価差額も入力）');
  });

  it('既存選択肢の概要に追加金額（0円を含む）を明示し、編集時だけ入力欄を開く', () => {
    const existingEditor = choices.slice(choices.indexOf('if (isNew) return'), choices.indexOf('export function OptionVariantManager'));
    expect(existingEditor).toContain('data-testid="variant-choice-price-editor"');
    expect(existingEditor).toContain('<details');
    expect(existingEditor).toContain('<summary');
    expect(existingEditor).toContain('choice.extra_price.toLocaleString');
    expect(existingEditor).toContain("choice.price_on_request ? '別途見積'");
    expect(existingEditor).toContain('編集 <span aria-hidden="true">▾</span>');
    expect(choices).toContain('label="原価差額（税別・円）"');
    expect(choices).toContain('name="extra_price"');
    expect(choices).toContain('defaultValue={choice?.extra_price ?? 0}');
    expect(choices).toContain('標準と同じなら0円です。');
    expect(choices).toContain('表示などの詳細設定');
  });

  // v2.5 PR-A3：金額は今の extra_price の列に保存し、登録済みの商品だけ本部の保存で原価差額の Version（DB の RPC）にも記録する
  it('既存extra_price保存経路を維持し、Version の記録は DB の RPC に任せる', () => {
    expect(choices).toContain('useActionState(saveVariantChoiceAction, initial)');
    expect(action).toContain("formData.get('extra_price') || 0");
    expect(action).toContain("recordPublishedChoiceCosts(optionId, 'choice', [choiceId])");
    expect(action).toContain('extra_price: parsed.data.extra_price');
    expect(choices).not.toContain('extra_price_adjusted');
    expect(choices).not.toContain('saveOptionAction(');
    expect(registered).toContain('追加・編集・価格変更はまだできません');
    expect(registered).toContain('choice.extra_price');
  });
});
