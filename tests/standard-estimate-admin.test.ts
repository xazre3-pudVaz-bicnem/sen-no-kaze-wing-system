import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseLineMoney, lineMoney, revisionMoney, sectionMoney } from '@/lib/domain/standard-estimate-money';
import { moveLineWithinSection, previewStandardEstimate, toSaveLines, type StandardEstimateEditorState } from '@/lib/domain/standard-estimate-view';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');

const state: StandardEstimateEditorState = {
  sales_fee_rate: '1.07',
  expense_rate: '0.15',
  markup_rate: '1.5',
  adjustment: -719,
  adjustment_reason: '端数調整',
  section_methods: { base: 'rate', interior_exterior: 'rate', option: 'rate', sitework: 'none' },
  lines: [
    { line_key: null, section_code: 'option', group_label: null, name: '洗面器', quantity: '1', unit: '台', price_mode: 'auto', cost_unit_price: 46150, unit_price: null, remark: null },
    { line_key: null, section_code: 'option', group_label: null, name: '未定の備品', quantity: '1', unit: null, price_mode: 'por', cost_unit_price: 500, unit_price: 900, remark: null },
    { line_key: null, section_code: 'sitework', group_label: null, name: '据付', quantity: '2.5', unit: '式', price_mode: 'manual', cost_unit_price: 999, unit_price: 2000, remark: null },
  ],
};
const baseLines = [{ section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 18200 }];

describe('標準見積の管理画面：試算（DB と同じ式）', () => {
  it('本体は本体マスターの行から、明細は price_mode どおりに計算し、POR は合計から除外する', () => {
    const preview = previewStandardEstimate(baseLines, state, '0.10');
    expect(preview.errors).toEqual([]);
    const rates = { salesFeeRate: '1.07', expenseRate: '0.15', markupRate: '1.5', taxRate: '0.10' };
    const base = sectionMoney([baseLineMoney(18200, '12', rates)], 'rate', rates);
    const option = sectionMoney(
      [lineMoney({ mode: 'auto', quantity: '1', costUnitPrice: 46150 }, rates), lineMoney({ mode: 'por', quantity: '1', costUnitPrice: null }, rates)],
      'rate',
      rates
    );
    const sitework = sectionMoney([lineMoney({ mode: 'manual', quantity: '2.5', costUnitPrice: 999, saleUnitPrice: 2000 }, rates)], 'none', rates);
    const expected = revisionMoney([base, sectionMoney([], 'rate', rates), option, sitework], -719, rates);
    expect(preview.money).toEqual(expected);
    expect(preview.sections.option.hasPor).toBe(true);
    expect(preview.lines[2]).toMatchObject({ saleAmount: 5000, costAmount: 2497 });
  });

  it('入力に誤りがある行は試算せず、誤りを返す（保存もできない）', () => {
    const bad = previewStandardEstimate(baseLines, { ...state, lines: [{ ...state.lines[0], quantity: '0' }] }, '0.10');
    expect(bad.money).toBeNull();
    expect(bad.errors[0]).toContain('1行目');
    expect(previewStandardEstimate(baseLines, { ...state, markup_rate: 'x' }, '0.10').money).toBeNull();
  });

  it('保存で送るのは単価と方法だけ（POR は原価を送らず、manual 以外は売価を送らない）', () => {
    const lines = toSaveLines(state.lines);
    expect(lines[0]).toMatchObject({ price_mode: 'auto', cost_unit_price: 46150, unit_price: null });
    expect(lines[1]).toMatchObject({ price_mode: 'por', cost_unit_price: null, unit_price: null });
    expect(lines[2]).toMatchObject({ price_mode: 'manual', cost_unit_price: 999, unit_price: 2000 });
  });

  it('見出しは保存で送り、空欄は見出しなしになる', () => {
    const lines = toSaveLines([
      { ...state.lines[0], group_label: '２．その他の設備' },
      { ...state.lines[1], group_label: null },
    ]);
    expect(lines[0].group_label).toBe('２．その他の設備');
    expect(lines[1].group_label).toBeNull();
  });

  it('並べ替えは同じ区分の中だけで、ひとつ前／後ろの行と入れ替える（区分の端では動かない）', () => {
    const names = (lines: typeof state.lines) => lines.map((line) => line.name);
    const lines = [
      state.lines[0],
      { ...state.lines[2], name: '据付' },
      { ...state.lines[0], name: '室内造作' },
      { ...state.lines[1], name: '各種養生' },
    ];
    // 室内造作（option）を上へ：間の sitework を飛ばして、ひとつ前の option（洗面器）と入れ替わる
    expect(names(moveLineWithinSection(lines, 2, -1))).toEqual(['室内造作', '据付', '洗面器', '各種養生']);
    // 室内造作を下へ：各種養生と入れ替わる
    expect(names(moveLineWithinSection(lines, 2, 1))).toEqual(['洗面器', '据付', '各種養生', '室内造作']);
    // 区分の先頭・末尾、ほかに同じ区分の行がないときは変えない
    expect(moveLineWithinSection(lines, 0, -1)).toBe(lines);
    expect(moveLineWithinSection(lines, 3, 1)).toBe(lines);
    expect(moveLineWithinSection(lines, 1, 1)).toBe(lines);
  });
});

describe('標準見積の管理画面：権限と DB の呼び方', () => {
  const actions = read('lib/actions/standard-estimates.ts');
  const editor = read('components/admin/standard-estimate-editor.tsx');
  const detail = read('app/admin/standard-estimates/[revisionId]/page.tsx');
  const list = read('app/admin/standard-estimates/page.tsx');

  it('操作は本部だけで、金額は DB の RPC（PR E）に計算させる', () => {
    // 作成・保存・公開・次の Revision・標準状態の商品（PR C1）・シミュレーターの価格の切り替え
    expect(actions.match(/await requireAdmin\('\/admin\/standard-estimates'\)/g)).toHaveLength(6);
    for (const rpc of ['create_standard_estimate_draft', 'save_standard_estimate_draft', 'publish_standard_estimate_revision', 'start_next_standard_estimate_revision']) {
      expect(actions).toContain(`rpc('${rpc}'`);
    }
    expect(actions).toContain('p_expected_lock_version: value.expected_lock_version');
    // 表へ直接は書き込まない
    expect(actions).not.toMatch(/\.from\('standard_estimate_[a-z_]+'\)[\s\S]{0,120}\.(insert|update|delete|upsert)\(/);
  });

  it('公開済みは読み取り専用で、保存後は DB の内容で画面を作り直す', () => {
    expect(detail).toContain("readOnly={!isDraft}");
    expect(detail).toContain('key={revision.lock_version}');
    expect(editor).toContain('router.refresh()');
    expect(list).toContain('createStandardEstimateDraftAction');
    expect(read('components/admin/admin-nav.tsx')).toContain("'/admin/standard-estimates',");
  });

  it('明細ごとに見出しを入力でき、同じ区分の中で並べ替えられる', () => {
    expect(editor).toContain('aria-label="見出し"');
    expect(editor).toContain('group_label: e.target.value || null');
    expect(editor).toContain('aria-label="上へ"');
    expect(editor).toContain('aria-label="下へ"');
    expect(editor).toContain('moveLineWithinSection(current.lines, index, direction)');
  });
});
