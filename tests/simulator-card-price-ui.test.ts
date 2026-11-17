import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EquipmentBoard, type EquipmentSlotTile } from '@/components/simulator/equipment-board';
import { simulatorCardPricePresentation } from '@/lib/domain/simulator-card-price-presentation';
import type { SimulatorCardDelta, SimulatorCardTarget } from '@/lib/domain/simulator-card-price-delta';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';

const cat = (id: string, code: string) => ({
  id, code, name: code, description: null, group_sort: 1, sort_order: 1,
}) as unknown as OptionCategory;
const product = (id: string, categoryId: string) => ({
  id, code: id, name: id, category_id: categoryId, image_url: null, description: null,
  status: 'published', price_on_request: false, show_in_simulator: true, sort_order: 1,
}) as unknown as ProductOption;

const categories = [
  cat('cat-roof', 'roof'),
  cat('cat-toilet', 'toilet'),
  cat('cat-bed', 'bed'),
  cat('cat-sash', 'sash'),
  cat('cat-kitchen', 'kitchen'),
];

const options = [
  product('roof-upgrade', 'cat-roof'),
  product('toilet-standard', 'cat-toilet'),
  product('bed-economy', 'cat-bed'),
  product('window-upgrade', 'cat-sash'),
];

const slotTiles: EquipmentSlotTile[] = [{
  slotCode: 'window-1', categoryId: 'cat-sash',
  label: '開き窓①', option: options[3], variantNames: ['ホワイト'],
}];

function renderBoard(evaluate: (target: SimulatorCardTarget) => SimulatorCardDelta = (target) => {
  if (target.kind === 'slot') return { kind: 'changed', deltaIncludingTax: 0 };
  if (target.kind !== 'category') return { kind: 'pending', reason: 'incomplete-selection' };
  if (target.categoryId === 'cat-roof') return { kind: 'changed', deltaIncludingTax: 22_000 };
  if (target.categoryId === 'cat-toilet') return { kind: 'standard' };
  if (target.categoryId === 'cat-bed') return { kind: 'changed', deltaIncludingTax: -8_800 };
  return { kind: 'pending', reason: 'unresolved-unit' };
}) {
  return renderToStaticMarkup(createElement(EquipmentBoard, {
    categories, options, selected: options.map((option) => option.id),
    baselineSelected: ['toilet-standard'],
    readOnly: false, onPickCategory: () => {}, onPickSlot: () => {},
    slotTiles, getCardDelta: evaluate,
  }));
}

describe('プランボードの税込変更影響額表示', () => {
  it('税込金額だけを表示し、標準・増額・減額・同額変更・未確定を混同しない', () => {
    expect(simulatorCardPricePresentation({ kind: 'standard' })).toEqual({
      label: '基本プランに含む', tone: 'neutral',
    });
    expect(simulatorCardPricePresentation({ kind: 'changed', deltaIncludingTax: 22_000 })).toEqual({
      label: '＋22,000円（税込）', tone: 'increase',
    });
    expect(simulatorCardPricePresentation({ kind: 'changed', deltaIncludingTax: -8_800 })).toEqual({
      label: '−8,800円（税込）', tone: 'decrease',
    });
    expect(simulatorCardPricePresentation({ kind: 'changed', deltaIncludingTax: 0 })).toEqual({
      label: '変更しても差額なし', tone: 'neutral',
    });
    expect(simulatorCardPricePresentation({ kind: 'pending', reason: 'unresolved-unit' })).toEqual({
      label: '金額確認中', tone: 'neutral',
    });
    expect(simulatorCardPricePresentation({ kind: 'pending', reason: 'price-on-request' }).label).toBe('金額確認中');
    expect(simulatorCardPricePresentation({ kind: 'pending', reason: 'no-published-price' }).label).toBe('金額確認中');
  });

  it('通常商品・位置別商品のカードで同じ税込表示と正しい文字色を使う', () => {
    const html = renderBoard();
    expect(html).toContain('＋22,000円（税込）');
    expect(html).toContain('−8,800円（税込）');
    expect(html).toContain('基本プランに含む');
    expect(html).toContain('変更しても差額なし');
    expect(html).toContain('金額確認中');
    expect(html).toMatch(/text-red-700" data-testid="equip-price-roof" data-price-tone="increase"/);
    expect(html).toMatch(/text-blue-700" data-testid="equip-price-bed" data-price-tone="decrease"/);
    expect(html).toMatch(/data-testid="equip-slot-price-window-1" data-price-tone="neutral"/);
    expect(html).toContain('data-testid="equipment-price-impact-note"');
    expect(html).toContain('各商品の差額は単純合計できない場合があります');
  });

  it('位置の未確定や選択ゼロでも、見積単価を推定して表示しない', () => {
    const html = renderBoard((target) => {
      if (target.kind !== 'category') return { kind: 'pending', reason: 'incomplete-selection' };
      if (target.categoryId === 'cat-kitchen') return { kind: 'pending', reason: 'price-on-request' };
      return { kind: 'standard' };
    });
    expect(html).toMatch(/data-testid="equip-slot-price-window-1" data-price-tone="neutral">金額確認中/);
    expect(html).toMatch(/data-testid="equip-price-kitchen" data-price-tone="neutral">金額確認中/);
    expect(html).not.toContain('＋22,000円（税込）');
    expect(html).toContain('選択なし');
  });

  it('画像・クリック操作・スマートフォン表示を維持し、Bのポップアップは変更範囲外', () => {
    const board = readFileSync(path.resolve(process.cwd(), 'components/simulator/equipment-board.tsx'), 'utf8');
    const app = readFileSync(path.resolve(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect((board.match(/className="object-contain p-1\.5"/g) ?? [])).toHaveLength(2);
    expect(board).toContain('onClick={() => onPickSlot?.(tile.slotCode)}');
    expect(board).toContain('onClick={() => onPickCategory(cat.id)}');
    expect(board).toContain('sm:h-28');
    expect(board).toContain('sm:grid-cols-3 lg:grid-cols-4');
    expect(app).toContain('createSimulatorCardDeltaEvaluator');
    expect(app).toContain('activeSlotCodes: positionSlots.filter(slotInScope(finishLevel))');
    expect(app).toContain('unitLookup: v25Units');
    expect(app).toContain('kind: \'legacy-template\'');
    expect(app).toContain('kind: \'v25-pending\'');
    expect(app).toContain('kind: \'legacy\', baseOverride');
    expect(app).toContain('getCardDelta={getCardDelta}');
    expect(board).toContain('const priceState = delta ? null : equipmentCategoryPriceState');
    expect(board).toContain('getCardDelta && (');
  });
});
