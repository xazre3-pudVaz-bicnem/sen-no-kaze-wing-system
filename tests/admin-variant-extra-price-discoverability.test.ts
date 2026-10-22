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
    expect(choices).toContain('③ 各選択肢の追加金額');
    expect(choices).toContain('最初の選択肢を追加（追加金額も入力）');
    expect(choices).toContain('選択肢を追加（追加金額も入力）');
  });

  it('既存の選択肢の追加金額欄は折り畳まず表示し、0円も明示する', () => {
    const existingEditor = choices.slice(choices.indexOf('if (isNew) return'), choices.indexOf('export function OptionVariantManager'));
    expect(existingEditor).toContain('data-testid="variant-choice-price-editor"');
    expect(existingEditor).not.toContain('<details');
    expect(choices).toContain('label="追加金額（税別・円）"');
    expect(choices).toContain('name="extra_price"');
    expect(choices).toContain('defaultValue={choice?.extra_price ?? 0}');
    expect(choices).toContain('追加金額 ¥{choice.extra_price.toLocaleString');
    expect(choices).toContain('追加がなければ0円です。');
    expect(choices).toContain('表示などの詳細設定');
  });

  it('既存extra_price保存経路を維持し、新たな金額正本を作らない', () => {
    expect(choices).toContain('useActionState(saveVariantChoiceAction, initial)');
    expect(action).toContain("extra_price: formData.get('extra_price') || 0");
    expect(action).toContain('extra_price: parsed.data.extra_price');
    expect(choices).not.toContain('extra_price_adjusted');
    expect(choices).not.toContain('saveOptionAction(');
    expect(registered).toContain('追加・編集・価格変更はまだできません');
    expect(registered).toContain('choice.extra_price');
  });
});
