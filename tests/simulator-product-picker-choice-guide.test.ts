import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SIMULATOR_PRODUCT_CHOICE_POINTS,
  orderPickerProducts,
  productChoicePoints,
} from '@/lib/domain/simulator-product-choice-guide';
import {
  WASHBASIN_STANDARD_SET_ID,
  isWashbasinDisplayOptionSelected,
  washbasinDisplayOptions,
} from '@/lib/domain/washbasin-selection';
import { C, seedOptions } from '@/lib/seed/catalog';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const list = read('components/simulator/product-list.tsx');
const picker = read('components/simulator/option-picker-dialog.tsx');
const detail = read('components/simulator/product-detail.tsx');
const exterior = read('components/simulator/exterior-wall-faces-dialog.tsx');
const app = read('components/simulator/simulator-app.tsx');

describe('商品選択ポップアップ：第1段階・14カテゴリー案内', () => {
  it('C調査対象14カテゴリーを過不足なく含み、固定の比較軸は各2〜3項目', () => {
    const expected = [
      'exterior-wall', 'roof', 'ub', 'toilet', 'washbasin', 'kitchen',
      'boiler', 'aircon', 'lighting', 'entrance-door', 'service-door',
      'sash', 'interior-door', 'furniture',
    ];
    expect(Object.keys(SIMULATOR_PRODUCT_CHOICE_POINTS).sort()).toEqual([...expected].sort());
    for (const category of expected) {
      const points = productChoicePoints(category);
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(points.length).toBeLessThanOrEqual(3);
      expect(points.every((point) => point.trim().length > 0)).toBe(true);
    }
    expect(productChoicePoints('toilet')).toEqual(['洗浄機能', '手洗いの有無', 'お手入れ']);
    expect(productChoicePoints('aircon')).toContain('電源条件');
    expect(productChoicePoints('ub')).toContain('サイズ');
    expect(productChoicePoints('entrance-door')).toContain('断熱・防火仕様');
    expect(productChoicePoints('sash')).toContain('開閉方式');
    expect(productChoicePoints('unknown')).toEqual([]);
  });

  it('現在選択中→基本プラン→変更候補、同一グループ内の元の順序を保持する', () => {
    const products = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, ref: id }));
    const snapshot = JSON.stringify(products);
    const result = orderPickerProducts(products, ['d', 'b'], ['e', 'b', 'c']);
    expect(result.map((item) => item.id)).toEqual(['b', 'd', 'c', 'e', 'a', 'f']);
    expect(result[0]).toBe(products[1]);
    expect(JSON.stringify(products)).toBe(snapshot);
  });

  it('トイレの現在選択中と基本プランを別判定し、両方に該当しても並びを崩さない', () => {
    const options = [
      { id: 'upgrade-a', is_default: false },
      { id: 'standard', is_default: false },
      { id: 'upgrade-b', is_default: true },
      { id: 'upgrade-c', is_default: false },
    ];
    const baseline = ['standard'];
    const selected = ['upgrade-b'];
    expect(orderPickerProducts(options, selected, baseline).map((o) => o.id))
      .toEqual(['upgrade-b', 'standard', 'upgrade-a', 'upgrade-c']);
    expect(orderPickerProducts(options, ['standard'], baseline).map((o) => o.id))
      .toEqual(['standard', 'upgrade-a', 'upgrade-b', 'upgrade-c']);
    // is_default は商品台帳側の値。表示順の根拠にしてはならない。
    expect(orderPickerProducts(options, [], baseline).map((o) => o.id)[0]).toBe('standard');
  });

  it('複数選択と位置別商品でも現在選択中を複数先頭に維持できる', () => {
    const options = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    expect(orderPickerProducts(options, ['e', 'c', 'a'], ['b', 'c']).map((o) => o.id))
      .toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(orderPickerProducts(options, ['e'], ['c']).map((o) => o.id))
      .toEqual(['e', 'c', 'a', 'b', 'd']);
  });

  it('旧洗面器と混合水栓は2商品で1表示。セット全体が基本・選択中なら両方表示可', () => {
    const options = seedOptions.filter((option) => option.category_id === C.washbasin);
    const basin = options.find((option) => option.code === 'washbasin-kb');
    const faucet = options.find((option) => option.code === 'faucet-kb');
    expect(basin).toBeDefined();
    expect(faucet).toBeDefined();
    const ids = [basin!.id, faucet!.id];
    const display = washbasinDisplayOptions(options, ids);
    const set = display.find((option) => option.id === WASHBASIN_STANDARD_SET_ID);
    expect(set).toBeDefined();
    expect(isWashbasinDisplayOptionSelected(set!, ids, options)).toBe(true);
    expect(isWashbasinDisplayOptionSelected(set!, [ids[0]], options)).toBe(false);
    const baselineDisplayIds = display.filter((option) =>
      isWashbasinDisplayOptionSelected(option, ids, options)).map((option) => option.id);
    const selectedDisplayIds = display.filter((option) =>
      isWashbasinDisplayOptionSelected(option, ids, options)).map((option) => option.id);
    expect(baselineDisplayIds).toContain(WASHBASIN_STANDARD_SET_ID);
    expect(selectedDisplayIds).toContain(WASHBASIN_STANDARD_SET_ID);
    expect(orderPickerProducts(display, selectedDisplayIds, baselineDisplayIds)[0].id)
      .toBe(WASHBASIN_STANDARD_SET_ID);
  });
});

describe('商品選択ポップアップ：表示のみのUI結線・回帰', () => {
  it('商品カードの状態は基本プランと現在選択中の独立バッジ（両方可能）', () => {
    expect(list).toContain('baselineSelectedIds: string[]');
    expect(list).toContain('new Set(selectedIds)');
    expect(list).toContain('new Set(baselineSelectedIds)');
    expect(list).toContain('orderPickerProducts(options, selectedIds, baselineSelectedIds)');
    expect(list).toContain('product-card-current-');
    expect(list).toContain('product-card-baseline-');
    // 同じ「基本プランの商品」がバッジと金額欄の両方に出る場合のみ隠す。
    // 別途見積や金額（getPriceLabel結果）はそのまま表示する。
    expect(list).toContain("isBaseline && displayPrice === '基本プランの商品'");
    expect(list).toContain('{!redundantBasicPlanText && <p');
    expect(list).toContain('const displayPrice = getPriceLabel(option);');
    expect(list).toContain('[overflow-wrap:anywhere]');
    expect(list).toContain('現在選択中');
    expect(list).toContain('基本プランの商品');
    expect(list).not.toContain('is_default');
    expect(detail).toContain('isCurrentlySelected || isBasicPlanProduct');
    expect(detail).toContain('product-detail-current');
    expect(detail).toContain('product-detail-baseline');
  });

  it('14カテゴリーの選ぶポイントを上に表示し、性能の断定や推測比較文を作らない', () => {
    expect(picker).toContain('productChoicePoints(category.code)');
    expect(picker).toContain('data-testid="product-choice-guide"');
    expect(picker).toContain('data-testid="product-choice-guide-points"');
    expect(picker).toContain('比較するときの目安です');
    expect(picker).not.toContain('option.highlight.slice');
    expect(picker).not.toContain('option.description.slice');
    expect(list).not.toContain('highlight');
    expect(list).not.toContain('description');
    expect(list).toContain('option.model_no');
    expect(list).toContain('option.size_note');
  });

  it('洗面セットの標準判定は表示用IDに変換し、位置別選択は渡された枠の選択を維持', () => {
    expect(picker).toContain('isWashbasinDisplayOptionSelected(option, baselineSelectedIds, options)');
    expect(picker).toContain('isWashbasinDisplayOptionSelected(option, selectedInCategory, options)');
    expect(picker).toContain('baselineSelectedIds={displayBaselineSelectedIds}');
    expect(picker).toContain('selectedIds={displaySelectedIds}');
    expect(app).toContain('selectedIds={[slotPickerRow.selection.option_id]}');
    expect(app).toContain('baselineSelectedIds={[slotPickerRow.standard.option_id]}');
    expect(picker).toContain('nextSimulatorSelectedProducts(category, selectedInCategory, option.id');
    expect(picker).toContain('onApply(nextSelected, [...preservedVariants, ...draftVariantIds]);');
  });

  it('PC・スマホどちらも商品画像を切り抜かず、商品カード枠とバッジを保つ', () => {
    expect(list).toContain('relative aspect-[3/2] bg-sand');
    expect(list).toContain('className="object-contain p-2"');
    expect(list).not.toContain('object-cover');
    expect(list).toContain('grid-cols-1 gap-2 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4');
    expect(list).toContain('flex-col items-start gap-1');
    expect(picker).toContain('flex flex-wrap gap-1.5');
    expect(detail).toContain('flex max-w-full shrink-0 flex-wrap items-center gap-1.5');
  });

  it('外壁4面専用UIを変えず、商品リストの状態と比較ポイントだけ追加', () => {
    expect(exterior).toContain('productChoicePoints(category.code)');
    expect(exterior).toContain('baselineSelectedIds={baselineSelectedIds}');
    expect(app).toContain('baselineSelectedIds={activeSpecSelection}');
    expect(exterior).toContain('replaceFace({');
    expect(exterior).toContain('const copyToAll = () =>');
    expect(exterior).toContain('onApply(faces)');
    expect(exterior).toContain('faces.length !== 4');
  });

  it('既存の価格計算・金額ラベル・仕様選択・反映処理を呼び出し続ける', () => {
    expect(picker).toContain('equipmentCategoryPriceBreakdown({');
    expect(picker).toContain('const priceLabel = (option: ProductOption) =>');
    expect(picker).toContain('totalPriceLabel(priceBreakdown(option, optionVariantIds(option)).state)');
    expect(picker).toContain('return value > 0 ? `+${formatYen(value)}` : formatYen(value)');
    expect(picker).toContain('productPriceDetailLabel');
    expect(picker).toContain('variantPriceDetailLabel');
    expect(picker).toContain('totalPriceDetailLabel');
    expect(picker).toContain('onApply(nextSelected, [...preservedVariants, ...draftVariantIds]);');
    expect(exterior).toContain('option.price_on_request');
    expect(exterior).toContain('formatYen(option.price)');
  });
});
