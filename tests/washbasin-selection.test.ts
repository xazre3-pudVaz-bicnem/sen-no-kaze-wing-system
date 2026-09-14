import { describe, expect, it } from 'vitest';
import { C, seedOptions } from '@/lib/seed/catalog';
import {
  WASHBASIN_STANDARD_SET_ID,
  isWashbasinDisplayOptionSelected,
  legacyWashbasinOptions,
  washbasinDisplayOptions,
  washbasinSelectionIdsForOption,
} from '@/lib/domain/washbasin-selection';

const washbasinOptions = seedOptions.filter((option) => option.category_id === C.washbasin);
const legacy = legacyWashbasinOptions(washbasinOptions);
const baselineIds = legacy.map((option) => option.id);

describe('洗面の商品選択', () => {
  it('洗面器と混合水栓を一覧では1つの標準セットにまとめる', () => {
    const display = washbasinDisplayOptions(washbasinOptions, baselineIds);

    expect(display.some((option) => option.code === 'washbasin-kb')).toBe(false);
    expect(display.some((option) => option.code === 'faucet-kb')).toBe(false);

    const standardSet = display.find((option) => option.id === WASHBASIN_STANDARD_SET_ID);
    expect(standardSet).toMatchObject({
      name: '標準洗面セット',
      price: 159225,
      price_on_request: false,
    });
  });

  it('標準セットを選ぶと内部では洗面器と混合水栓の2商品を選択する', () => {
    const standardSet = washbasinDisplayOptions(washbasinOptions, baselineIds).find(
      (option) => option.id === WASHBASIN_STANDARD_SET_ID
    );
    expect(standardSet).toBeDefined();

    expect(washbasinSelectionIdsForOption(standardSet!, washbasinOptions)).toEqual(baselineIds);
    expect(
      isWashbasinDisplayOptionSelected(standardSet!, baselineIds, washbasinOptions)
    ).toBe(true);
  });

  it('洗面化粧台を選ぶ場合はその1商品のみを選択対象にする', () => {
    const alternative = washbasinOptions.find((option) => option.code === 'wash-lixil-esta-w600');
    expect(alternative).toBeDefined();

    expect(washbasinSelectionIdsForOption(alternative!, washbasinOptions)).toEqual([
      alternative!.id,
    ]);
  });
});
