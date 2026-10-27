import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChoiceExtraPrice } from '@/lib/domain/product-variant-creation-prices';
import { variantChoiceSchema } from '@/lib/validation';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const form = read('components/admin/product-registration-final-refinements.tsx');
const action = read('lib/actions/product-registration-variants.ts');

describe('選択項目の初回作成時に追加金額を入力して保存する', () => {
  it('初回作成画面でも選択肢名と同じ行に税別金額の入力欄を表示する', () => {
    expect(form).toContain('data-testid="two-line-choice"');
    expect(form).toContain('原価差額（税別・円）');
    expect(form).toContain('name={`choice_extra_price_${index}`}');
    expect(form).toContain('value={choicePrices[rowId] ?? \'0\'}');
    expect(form).toContain('min={0}');
    expect(form).toContain('max={100000000}');
    expect(form).toContain('step={1}');
    expect(form).toContain('金額は選択肢名に書かず');
    expect(form).toContain('name="standard_choice_index"');
  });

  it('選択肢の削除・標準変更後も行IDに金額を保持し、元の表示順で送信する', () => {
    expect(form).toContain('const [choicePrices, setChoicePrices] = useState<Record<number, string>>({})');
    expect(form).toContain('const rowId = choiceRowIds[index]');
    expect(form).toContain('name={`choice_extra_price_${index}`}');
    expect(form).toContain('delete next[removedRowId]');
    expect(form).toContain('setChoicePrices({})');
    expect(action).toContain('index >= standardIndex ? index + 1 : index');
    expect(action).toContain('extraPrice: choicePrices[standardIndex]!');
    expect(action).toContain('extraPrice: choicePrices[row.choiceIndex]!');
    expect(action).toContain('extra_price: input.extraPrice');
    expect(action).toContain('extra_price: choice.extra_price');
  });

  it('税別円の整数0〜1億円を受け付け、空欄・負数・小数・不正値を拒否する', () => {
    const data = new FormData();
    data.set('choice_extra_price_0', '460');
    data.set('choice_extra_price_1', '2500');
    expect(parseChoiceExtraPrice(data, 0)).toBe(460);
    expect(parseChoiceExtraPrice(data, 1)).toBe(2500);
    expect(parseChoiceExtraPrice(data, 2)).toBe(0); // 古い画面との互換
    for (const accepted of ['0', '0100', '100000000', ' 200 ']) {
      data.set('choice_extra_price_0', accepted);
      expect(parseChoiceExtraPrice(data, 0)).toBe(Number(accepted));
    }
    for (const invalid of ['', ' ', '-1', '0.5', '100000001', '1e3', '1,000', 'NaN']) {
      data.set('choice_extra_price_0', invalid);
      expect(parseChoiceExtraPrice(data, 0)).toBeNull();
    }
  });

  it('価格も選択肢をすべて検査してからDB保存に進み、名前なしの価格だけ保存しない', () => {
    expect(action).toContain('const invalidPriceIndex = choicePrices.findIndex');
    expect(action).toContain('if (invalidPriceIndex >= 0)');
    expect(action).toContain('choicePrices[row.choiceIndex] !== 0');
    expect(action).toContain('画像または原価差額を指定した選択肢には名前を入力してください');
    expect(action.indexOf('invalidPriceIndex >= 0')).toBeLessThan(action.indexOf('await store.upsertVariantGroup'));
    expect(action.indexOf('extra_price: input.extraPrice')).toBeLessThan(action.indexOf('await store.upsertVariantGroup'));
    expect(variantChoiceSchema.safeParse({
      id: null,
      option_id: '11111111-1111-4111-8111-111111111111',
      group_id: '22222222-2222-4222-8222-222222222222',
      code: 'vc-test',
      name: '40mm',
      kind: 'option',
      extra_price: 460,
      price_on_request: false,
      image_url: null,
      note: null,
      sort_order: 1,
      status: 'published',
    }).success).toBe(true);
  });
});
