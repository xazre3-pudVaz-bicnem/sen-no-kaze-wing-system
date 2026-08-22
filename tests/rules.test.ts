import { describe, expect, it } from 'vitest';
import { defaultSelection, explainBlocked, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
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
