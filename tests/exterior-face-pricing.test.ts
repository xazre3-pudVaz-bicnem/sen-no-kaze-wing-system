import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveExteriorFaces, getExteriorFaces } from '@/lib/data/exterior-faces';
import { LocalStore } from '@/lib/data/local-store';
import { computePricing } from '@/lib/domain/pricing';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import type { OptionVariantChoice, OptionVariantGroup } from '@/lib/domain/types';
import { MODEL_WING01_ID, seedCategories, seedModels, seedOptions, seedVariantChoices, seedVariantGroups } from '@/lib/seed/catalog';

const model = seedModels.find((row) => row.id === MODEL_WING01_ID)!;
const standardWall = seedOptions.find((row) => row.code === 'exterior-galnote')!;
const paidWall = seedOptions.find((row) => row.code === 'exterior-wood')!;
const faceCodes = ['front', 'right', 'back', 'left'] as const;

function faces(optionId: string, variantChoiceIds: string[] = []): ExteriorFaceSelection[] {
  return faceCodes.map((face_code) => ({ face_code, option_id: optionId, variant_choice_ids: [...variantChoiceIds] }));
}

function priceWithFaces(
  exteriorFaces: ExteriorFaceSelection[],
  selections = [{ option_id: standardWall.id }],
  variants = { groups: seedVariantGroups, choices: seedVariantChoices }
) {
  return computePricing(model, seedOptions, seedCategories, selections, undefined, variants, null, exteriorFaces);
}

describe('外壁4面の価格計算', () => {
  it('標準外壁4面は追加0円', () => {
    const pricing = priceWithFaces(faces(standardWall.id));

    expect(pricing.option_subtotal).toBe(0);
    expect(pricing.option_expense).toBe(0);
    expect(pricing.lines.filter((line) => line.category_code === 'exterior-wall')).toHaveLength(4);
  });

  it('1面だけ有料外壁の場合はその1面分だけ追加する', () => {
    const exteriorFaces = faces(standardWall.id);
    exteriorFaces[0] = { face_code: 'front', option_id: paidWall.id, variant_choice_ids: [] };
    const pricing = priceWithFaces(exteriorFaces);

    expect(pricing.option_subtotal).toBe(paidWall.price);
    expect(pricing.option_expense).toBe(Math.floor(paidWall.price * 0.15));
    expect(pricing.lines.filter((line) => line.amount > 0)).toHaveLength(1);
  });

  it('4面すべて有料外壁の場合は4面分を計算する', () => {
    const pricing = priceWithFaces(faces(paidWall.id));

    expect(pricing.option_subtotal).toBe(paidWall.price * 4);
    expect(pricing.option_expense).toBe(Math.floor(paidWall.price * 4 * 0.15));
  });

  it('面別バリエーション追加額を反映する', () => {
    const group: OptionVariantGroup = {
      id: 'exterior-face-test-group',
      option_id: paidWall.id,
      code: 'color',
      name: '色',
      note: null,
      sort_order: 1,
      is_required: true,
      status: 'published',
    };
    const choice: OptionVariantChoice = {
      id: 'exterior-face-test-choice',
      group_id: group.id,
      code: 'premium',
      name: 'プレミアム色',
      kind: 'option',
      extra_price: 25_000,
      price_on_request: false,
      image_url: null,
      note: null,
      sort_order: 1,
      status: 'published',
    };
    const exteriorFaces = faces(standardWall.id);
    exteriorFaces[0] = { face_code: 'front', option_id: paidWall.id, variant_choice_ids: [choice.id] };
    const pricing = priceWithFaces(exteriorFaces, [{ option_id: standardWall.id }], { groups: [group], choices: [choice] });

    expect(pricing.option_subtotal).toBe(paidWall.price + choice.extra_price);
    expect(pricing.lines.find((line) => line.code.endsWith('__face_front'))?.variants[0].extra_price).toBe(choice.extra_price);
  });

  it('従来の外壁商品が選択状態に残っていても二重計上しない', () => {
    const exteriorFaces = faces(standardWall.id);
    exteriorFaces[0] = { face_code: 'front', option_id: paidWall.id, variant_choice_ids: [] };
    const pricing = priceWithFaces(exteriorFaces, [{ option_id: paidWall.id }]);

    expect(pricing.option_subtotal).toBe(paidWall.price);
    expect(pricing.lines.filter((line) => line.category_code === 'exterior-wall')).toHaveLength(4);
  });

  it('外壁4面未設定の旧configurationは従来の1商品計算を維持する', () => {
    const pricing = computePricing(model, seedOptions, seedCategories, [{ option_id: paidWall.id }]);

    expect(pricing.option_subtotal).toBe(paidWall.price);
    expect(pricing.lines.filter((line) => line.category_code === 'exterior-wall')).toHaveLength(1);
  });
});

describe.sequential('ローカル保存から見積生成までの外壁4面価格', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-exterior-face-pricing-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('保存・再読込・見積生成の金額と4面明細がシミュレーター計算と一致する', async () => {
    const actor = { id: 'local-face-test-user', email: 'face@example.com', role: 'customer' as const, full_name: '外壁テスト' };
    const store = new LocalStore();
    const preset = model.presets.find((row) => row.code === 'hotel')!;
    const presetOptions = preset.option_codes.map((code) => seedOptions.find((row) => row.code === code)).filter((option): option is (typeof seedOptions)[number] => Boolean(option));
    const optionsByCategory = new Map<string, string[]>();
    for (const option of presetOptions) {
      const category = seedCategories.find((row) => row.id === option.category_id);
      if (category?.selection_mode === 'single') optionsByCategory.set(option.category_id, [option.id]);
      else optionsByCategory.set(option.category_id, [...(optionsByCategory.get(option.category_id) ?? []), option.id]);
    }
    const optionIds = [...optionsByCategory.values()].flat();
    const configuration = await store.saveConfiguration(actor, {
      id: null,
      base_model_id: model.id,
      name: '外壁4面価格テスト',
      option_ids: optionIds,
      preview_image_url: null,
      notes: null,
      finish_level: 'full',
      spec_code: 'hotel',
      variant_choice_ids: [],
    });
    const selectedFaces = faces(standardWall.id);
    selectedFaces[0] = { face_code: 'front', option_id: paidWall.id, variant_choice_ids: [] };
    await saveExteriorFaces(configuration.id, selectedFaces);

    const reloaded = await new LocalStore().getConfiguration(configuration.id, actor);
    expect(reloaded).not.toBeNull();
    expect(await getExteriorFaces(configuration.id)).toEqual(selectedFaces);
    const bundle = await new LocalStore().getCatalogBundle(model.id);
    expect(bundle).not.toBeNull();
    const expected = computePricing(
      bundle!.model,
      bundle!.options,
      bundle!.categories,
      reloaded!.items.map((item) => ({ option_id: item.option_id, quantity: item.quantity, variant_choice_ids: item.variant_choice_ids ?? [] })),
      undefined,
      { groups: bundle!.variantGroups, choices: bundle!.variantChoices },
      null,
      selectedFaces
    );

    const quote = await new LocalStore().createQuoteFromConfiguration(actor, configuration.id, {
      full_name: actor.full_name,
      company_name: null,
      email: actor.email,
      phone: '000-0000-0000',
      address: 'テスト住所',
      site_address: null,
    }, null);
    const detail = await new LocalStore().getQuote(quote.id, actor);
    const faceRows = detail!.items.filter((item) => item.name.startsWith('外壁仕様（'));

    expect(quote.option_subtotal).toBe(expected.option_subtotal);
    expect(quote.total).toBe(expected.total);
    expect(faceRows).toHaveLength(4);
    expect(faceRows.reduce((sum, item) => sum + item.amount, 0)).toBe(
      expected.lines.filter((line) => line.category_code === 'exterior-wall').reduce((sum, line) => sum + line.amount, 0)
    );
  });
});
