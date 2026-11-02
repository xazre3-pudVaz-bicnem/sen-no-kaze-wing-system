import { describe, expect, it } from 'vitest';
import { findUnresolvedLines } from '@/lib/domain/quote-por';
import {
  v25SourceSlotGroupLabel,
  v25SourceSlotName,
  v25SourceZeroLines,
  type V25SourceLine,
  type V25SourceSlot,
} from '@/lib/domain/standard-quote-v25-source';

const slot = (patch: Partial<V25SourceSlot> = {}): V25SourceSlot => ({
  section_code: 'option',
  option_name_snapshot: '設備1',
  category_name_snapshot: '設備',
  slot_label: null,
  price_mode: 'auto',
  cost_unit_price: 21400,
  manual_unit_price: null,
  variants: [],
  ...patch,
});

const line = (patch: Partial<V25SourceLine> = {}): V25SourceLine => ({
  section_code: 'option',
  name: '取付費',
  group_label: '工事',
  remark: null,
  price_mode: 'manual',
  unit_price: 10000,
  ...patch,
});

describe('v2.5 の標準見積の版から作る見積下書きの元の明細（PR-D1c）', () => {
  it('選択枠の品名は「商品名 ／ 仕様」（仕様は並び順）、見出しは「カテゴリー（位置）」。DB と同じ', () => {
    const sash = slot({
      option_name_snapshot: 'サッシ1',
      category_name_snapshot: 'サッシ',
      slot_label: '掃出し窓',
      variants: [
        { variant_choice_name_snapshot: '600×900', sort_order: 2 },
        { variant_choice_name_snapshot: '白', sort_order: 1 },
      ],
    });
    expect(v25SourceSlotName(sash)).toBe('サッシ1 ／ 白・600×900');
    expect(v25SourceSlotGroupLabel(sash)).toBe('サッシ（掃出し窓）');
    expect(v25SourceSlotName(slot())).toBe('設備1');
    expect(v25SourceSlotGroupLabel(slot())).toBe('設備');
  });

  it('品名が 120 文字を超えたら 119 文字＋「…」（DB の left と同じく文字数で数える）', () => {
    const name = v25SourceSlotName(slot({ option_name_snapshot: '𠮷'.repeat(130) }));
    expect(Array.from(name)).toHaveLength(120);
    expect(name.endsWith('…')).toBe(true);
    expect(v25SourceSlotName(slot({ option_name_snapshot: 'あ'.repeat(120) }))).toBe('あ'.repeat(120));
  });

  it('0 円の明細は、原価 0 円の auto・売価 0 円の manual だけ（別途見積・本体の区分は入れない）', () => {
    const zero = v25SourceZeroLines(
      [
        slot({ option_name_snapshot: '無償の部材', cost_unit_price: 0 }),
        slot({ option_name_snapshot: '有償の部材' }),
        slot({ option_name_snapshot: 'サービス品', price_mode: 'manual', manual_unit_price: 0, cost_unit_price: null }),
        slot({ option_name_snapshot: '別途見積の商品', price_mode: 'por', cost_unit_price: null }),
        slot({ option_name_snapshot: '施工の部材', section_code: 'sitework', cost_unit_price: 0 }),
      ],
      [line({ name: '養生', unit_price: 0 }), line(), line({ name: '据付工事', price_mode: 'por', unit_price: null, section_code: 'sitework' })]
    );
    expect(zero.map((row) => `${row.kind}:${row.name}:${row.description}`)).toEqual([
      'option:無償の部材:設備',
      'option:サービス品:設備',
      'installation:施工の部材:設備',
      'option:養生:工事',
    ]);
  });

  it('初回の下書き：版の 0 円の明細は変えていなければ止めず、新しく足した 0 円の行は止める（DB と同じ）', () => {
    const baselineLines = v25SourceZeroLines([], [line({ name: '養生', unit_price: 0 })]);
    const items = [
      { kind: 'option', name: '養生', description: '工事', remark: null, unit_price: 0, price_mode: 'manual' },
      { kind: 'option', name: '追加の0円', description: '工事', remark: null, unit_price: 0, price_mode: 'manual' },
      { kind: 'option', name: '取付費', description: '工事', remark: null, unit_price: 10000, price_mode: 'manual' },
    ];
    const unresolved = findUnresolvedLines(items, { baselineLines, matchLineKey: true });
    expect([...unresolved].map((item) => item.name)).toEqual(['追加の0円']);
  });
});
