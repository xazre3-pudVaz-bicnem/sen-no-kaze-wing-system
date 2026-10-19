import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { V25EditorState, V25Preview, V25ProductCandidate } from '@/lib/domain/standard-estimate-v25-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));

const { StandardEstimateV25Editor } = await import('@/components/admin/standard-estimate-v25-editor');

const candidates: V25ProductCandidate[] = [
  {
    id: 'p1',
    name: '検査商品1',
    categoryName: '設備',
    section: 'option' as const,
    variantGroups: [{ id: 'g1', name: 'サイズ', choices: [{ id: 'c1', name: '標準' }, { id: 'c2', name: '大' }] }],
  },
  { id: 'p3', name: '検査商品3', categoryName: '設備', section: 'option' as const, variantGroups: [] },
  { id: 'p5', name: '設置工事（施工）', categoryName: '施工', section: 'sitework' as const, variantGroups: [] },
  { id: 'p9', name: '取扱終了の商品', categoryName: '設備', section: 'option' as const, retired: true, variantGroups: [] },
];

const initial: V25EditorState = {
  sales_fee_rate: '1.07',
  markup_rate: '1.5',
  expense_rate: '0.15',
  adjustment: '0',
  adjustment_reason: '',
  slots: [
    { key: 'slot-b1', baseline_key: 'b1', option_id: 'p1', variant_choices: { g1: 'c2' }, quantity: '2', price_mode: 'auto' as const, manual_unit_price: '' },
    { key: 'slot-b3', baseline_key: 'b3', option_id: 'p3', variant_choices: {}, quantity: '1', price_mode: 'por' as const, manual_unit_price: '' },
    { key: 'slot-b9', baseline_key: 'b9', option_id: 'p9', variant_choices: {}, quantity: '1', price_mode: 'manual' as const, manual_unit_price: '5000' },
  ],
  lines: [
    {
      key: 'line-k1', line_key: 'k1', section_code: 'sitework' as const, group_label: '', name: '外構工事', quantity: '1', unit: '式',
      price_mode: 'por' as const, unit_price: '', remark: '', review_required: true,
    },
    {
      key: 'line-k2', line_key: 'k2', section_code: 'sitework' as const, group_label: '', name: '設置工事', quantity: '1', unit: '式',
      price_mode: 'manual' as const, unit_price: '50000', remark: '', review_required: false,
    },
  ],
};

const preview: V25Preview = {
  rules_current: true,
  review_required_lines: 1,
  publishable: false,
  calc_error: null,
  incomplete: [],
  slots: [
    { baseline_key: 'b1', option_id: 'p1', name: '検査商品1', price_mode: 'auto' as const, cost_status: 'stale' as const, variants: [{ variant_choice_id: 'c2', status: 'current' as const }] },
    { baseline_key: 'b3', option_id: 'p3', name: '検査商品3', price_mode: 'por' as const, cost_status: null, variants: [] },
  ],
};

const render = (readOnly: boolean) =>
  renderToStaticMarkup(
    createElement(StandardEstimateV25Editor, {
      revisionId: '00000000-0000-4000-8000-000000000001',
      lockVersion: 3,
      readOnly,
      initial,
      candidates,
      savedSlotAmounts: { b1: { amount: 369150, sale_unit_price: 184575 }, b3: { amount: null, sale_unit_price: null }, b9: { amount: 5000, sale_unit_price: 5000 } },
      savedLineAmounts: { k1: null, k2: 50000 },
      preview,
    })
  );

describe('標準見積 v2.5 の編集画面（描画）', () => {
  it('商品・選択肢・保存済みの金額・原価の状態を表示する', () => {
    const html = render(false);
    expect(html).toContain('検査商品1');
    expect(html).toContain('サイズを選ぶ');
    expect(html).toContain('¥369,150');
    expect(html).toContain('原価が更新されています');
  });

  it('別途見積は 0 円と表示せず「別途見積」と示す（選択枠・明細とも）', () => {
    const html = render(false);
    expect((html.match(/別途見積<\/span>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('¥0');
  });

  it('保存済みの取扱終了の商品は、選べない選択肢として残して表示する', () => {
    const html = render(false);
    expect(html).toContain('取扱終了の商品（取扱終了）');
    expect(html).toMatch(/<option value="p9" disabled=""( selected="")?>取扱終了の商品（取扱終了）<\/option>/);
  });

  it('以前の標準見積から写した明細は「要見直し」と示し、見直し済みにできる', () => {
    const html = render(false);
    expect(html).toContain('「要見直し」');
    expect(html).toContain('要見直し → 見直し済みにする');
  });

  it('公開できない理由（古い原価）を示し、公開のボタンは押せない', () => {
    const html = render(false);
    expect(html).toContain('公開できない理由');
    expect(html).toContain('「検査商品1」の原価が更新されています');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="v25-publish"/);
  });

  it('「要見直し」の明細が残っていれば、公開できない理由に出す', () => {
    const html = render(false);
    expect(html).toContain('「要見直し」の明細が 1 行残っています');
  });

  it('別途工事の商品の行では、自動計算を選べない', () => {
    const html = renderToStaticMarkup(
      createElement(StandardEstimateV25Editor, {
        revisionId: '00000000-0000-4000-8000-000000000001',
        lockVersion: 3,
        readOnly: false,
        initial: { ...initial, slots: [{ key: 'slot-b5', baseline_key: 'b5', option_id: 'p5', variant_choices: {}, quantity: '1', price_mode: 'por', manual_unit_price: '' }], lines: [] },
        candidates,
        savedSlotAmounts: {},
        savedLineAmounts: {},
        preview: { ...preview, review_required_lines: 0, slots: [] },
      })
    );
    expect(html).toMatch(/<option value="auto" disabled="">自動（商品の標準原価から計算）<\/option>/);
  });

  it('公開済み（読み取りだけ）では、保存・取り込み・公開・追加・削除を出さない', () => {
    const html = render(true);
    expect(html).not.toContain('data-testid="v25-save"');
    expect(html).not.toContain('data-testid="v25-publish"');
    expect(html).not.toContain('商品を追加');
    expect(html).not.toContain('>削除<');
    expect(html).toContain('要見直し');
  });
});
