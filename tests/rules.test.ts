import { describe, expect, it } from 'vitest';
import { categoriesInScope, defaultSelection, explainBlocked, pruneToScope, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
import type { FinishLevel } from '@/lib/domain/types';
import { MODEL_WING01_ID, O, seedCategories, seedConflicts, seedDependencies, seedOptions } from '@/lib/seed/catalog';

const wingOptions = seedOptions.filter((o) => o.base_model_id === null || o.base_model_id === MODEL_WING01_ID);
const ctx: RuleContext = {
  options: wingOptions,
  categories: seedCategories,
  dependencies: seedDependencies,
  conflicts: seedConflicts,
};

describe('toggleOption', () => {
  it('初期選択は必須カテゴリー（内装・造作）と別途工事を満たし、検証エラーがない', () => {
    const sel = defaultSelection(ctx);
    expect(sel).toContain(O.interiorStdWing);
    expect(sel).toContain(O.carpentryFullWing);
    expect(sel).toContain(O.swTransport);
    expect(validateSelection(ctx, sel)).toEqual([]);
  });

  it('ユニットバスを選ぶとガス給湯器が自動追加され通知される', () => {
    const r = toggleOption(ctx, defaultSelection(ctx), O.ub1216);
    expect(r.rejected).toBe(false);
    expect(r.next).toContain(O.gasBoiler);
    expect(r.notices.join('')).toContain('給湯器');
    // 依存されている給湯器は外せない
    const r2 = toggleOption(ctx, r.next, O.gasBoiler);
    expect(r2.rejected).toBe(true);
    expect(r2.notices[0]).toContain('外せません');
  });

  it('UB カテゴリーは単一選択: 3点ユニットを選ぶと UB1216 が外れる', () => {
    let sel = toggleOption(ctx, defaultSelection(ctx), O.ub1216).next;
    sel = toggleOption(ctx, sel, O.ub3point).next;
    expect(sel).toContain(O.ub3point);
    expect(sel).not.toContain(O.ub1216);
  });

  it('3点ユニット選択中は洗面器（単体）が理由付きで選べない', () => {
    const sel = toggleOption(ctx, defaultSelection(ctx), O.ub3point).next;
    const r = toggleOption(ctx, sel, O.washbasinKb);
    expect(r.rejected).toBe(true);
    expect(r.notices[0]).toContain('洗面器が含まれている');
    const blocked = explainBlocked(ctx, sel);
    expect(blocked.get(O.washbasinKb)).toBeTruthy();
  });

  it('必須の単一カテゴリー（内装）は解除できず、切り替えのみ可能', () => {
    let sel = defaultSelection(ctx);
    expect(toggleOption(ctx, sel, O.interiorStdWing).rejected).toBe(true);
    sel = toggleOption(ctx, sel, O.interiorHotelWing).next;
    expect(sel).toContain(O.interiorHotelWing);
    expect(sel).not.toContain(O.interiorStdWing);
  });

  it('validateSelection は競合・依存・必須未選択を検出する', () => {
    const issues = validateSelection(ctx, [O.ub3point, O.washbasinKb, O.faucetKb]);
    const types = issues.map((i) => i.type);
    expect(types).toContain('conflict');
    expect(types).toContain('dependency'); // 給湯器なし
    expect(types).toContain('required'); // 内装・造作・別途工事
  });
});

describe('注文範囲（本体のみ／本体＋設備／フル装備）', () => {
  const codeOf = (id: string) => wingOptions.find((o) => o.id === id)?.code ?? id;
  const catCodesIn = (level: FinishLevel) => categoriesInScope(seedCategories, level).map((c) => c.code).sort();

  it('本体のみでは本体に含まれるカテゴリーだけが対象になる', () => {
    expect(catCodesIn('shell')).toEqual(['exterior-wall', 'fireproof', 'insulation', 'sash', 'sitework']);
  });

  it('本体＋設備では設備・照明・家具が加わり、内装と造作は含まれない', () => {
    const codes = catCodesIn('equipment');
    for (const c of ['ub', 'toilet', 'kitchen', 'aircon', 'lighting', 'furniture', 'smartlock', 'exterior-parts']) {
      expect(codes).toContain(c);
    }
    for (const c of ['floor', 'wall-ceiling', 'interior-door', 'carpentry']) {
      expect(codes).not.toContain(c);
    }
  });

  it('フル装備ではすべてのカテゴリーが対象になる', () => {
    expect(catCodesIn('full').length).toBe(seedCategories.length);
  });

  it('本体のみの初期選択は内装・設備を含まず、検証エラーもない', () => {
    const sel = defaultSelection(ctx, 'shell');
    const codes = sel.map(codeOf);
    expect(codes).toContain('exterior-galnote');
    expect(codes).toContain('sash-standard');
    expect(codes).toContain('fire-standard');
    expect(codes).not.toContain('carpentry-full-wing');
    expect(codes.some((c) => c.startsWith('interior-'))).toBe(false);
    expect(validateSelection(ctx, sel, 'shell')).toEqual([]);
  });

  it('フル装備の構成をそのまま本体のみで保存しようとすると弾かれる', () => {
    const full = defaultSelection(ctx, 'full');
    const issues = validateSelection(ctx, full, 'shell');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes('注文範囲に含まれません'))).toBe(true);
  });

  it('pruneToScope はフル装備の構成を本体のみへ丸められる', () => {
    const full = defaultSelection(ctx, 'full');
    const shell = pruneToScope(ctx, full, 'shell');
    expect(shell.length).toBeLessThan(full.length);
    expect(validateSelection(ctx, shell, 'shell')).toEqual([]);
    // 本体＋設備へ広げても、丸めた分だけでは必須の欠落は起きない（設備は任意のため）
    expect(validateSelection(ctx, shell, 'equipment')).toEqual([]);
  });

  it('本体のみではユニットバスは選択できない扱いになる', () => {
    const sel = [...defaultSelection(ctx, 'shell'), O.ub1216, O.gasBoiler];
    const issues = validateSelection(ctx, sel, 'shell');
    expect(issues.some((i) => i.message.includes('ユニットバス'))).toBe(true);
    expect(pruneToScope(ctx, sel, 'shell')).not.toContain(O.ub1216);
  });
});
