import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from '@/lib/domain/standard-estimate-pricing';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013190000_standard_estimate_baseline_sale_view.sql');

function fn(name: string) {
  const start = migration.indexOf(`create function public.${name}(`);
  const tagStart = migration.indexOf('as $', start);
  const tag = migration.slice(tagStart + 3, migration.indexOf('$', tagStart + 4) + 1);
  return migration.slice(start, migration.indexOf(`${tag};`, tagStart + 3 + tag.length));
}

describe('標準状態の商品（PR C1）：DB の取り決め', () => {
  it('区分は、シミュレーターと同じ分け方の既存の関数（estimate_section_for_option）で DB が決める', () => {
    const legacy = read('supabase/migrations/20260911050000_standard_estimate_simulator.sql');
    const start = legacy.indexOf('create or replace function public.estimate_section_for_option(');
    const section = legacy.slice(start, legacy.indexOf('$$;', start));
    const list = /p_category_code in \(([^)]*)\)/.exec(section)?.[1] ?? '';
    const codes = [...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...INTERIOR_EXTERIOR_CATEGORY_CODES].sort());
    expect(section).toContain("when p_is_installation or p_category_code = 'free-product' then 'sitework'");
    expect(migration.match(/public\.estimate_section_for_option\(c\.code, o\.is_installation\)/g)).toHaveLength(2);
  });

  it('登録は本部だけ・下書きだけ・版の一致が必要で、権限は状態の判定より前に確認する', () => {
    const set = fn('set_standard_estimate_baseline');
    const permission = set.indexOf('can_edit_standard_estimate_master');
    expect(permission).toBeGreaterThan(0);
    expect(permission).toBeLessThan(set.indexOf("rev.status <> 'draft'"));
    expect(permission).toBeLessThan(set.indexOf('rev.lock_version is distinct from p_expected_lock_version'));
    // その仕様でお客様が選べるカテゴリーの、公開中の商品だけ
    expect(set).toContain('public.customer_category_selectable(v_model.slug, m.spec_code, c.code)');
    expect(set).toContain("o.status <> 'published'");
    expect(migration).toContain('grant execute on function public.set_standard_estimate_baseline(uuid, jsonb, integer) to authenticated;');
  });

  it('次の Revision へ引き継ぎ、公開の直前に商品台帳の現在の価格で snapshot を取り直す（適用済みの定義を検査して差し込む）', () => {
    expect(migration).toContain("v_signature constant text := 'public.start_next_standard_estimate_revision(uuid, uuid)';");
    expect(migration).toContain("v_signature constant text := 'public.publish_standard_estimate_revision(uuid, integer)';");
    expect(migration).toContain("perform public.copy_standard_estimate_baseline(cur.id, v_rev);");
    expect(migration).toContain("perform public.refresh_standard_estimate_baseline(rev.id);");
    expect(migration.match(/anchor % is not unique/g)).toHaveLength(2);

    const contract = read('supabase/migrations/20261013170000_standard_estimate_money_contract.sql');
    const body = (name: string) => {
      const start = contract.indexOf(`create function public.${name}(`);
      const as = contract.indexOf('as $$', start);
      return contract.slice(start, contract.indexOf('$$;', as + 5));
    };
    const once = (text: string, anchor: string) => text.split(anchor).length - 1;
    expect(once(body('start_next_standard_estimate_revision'), '  perform public.recalculate_standard_estimate_revision(v_rev, cur.standard_adjustment_amount, cur.standard_adjustment_reason);\n')).toBe(1);
    expect(once(body('publish_standard_estimate_revision'), '  perform public.recalculate_standard_estimate_revision(rev.id);\n')).toBe(1);
  });

  it('売価だけの取得経路は、原価・販売費率・掛率・調整理由・備考を返さない（未ログインでも使える）', () => {
    const view = fn('get_standard_estimate_sale_views');
    const keys = [...view.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]);
    expect(keys).toContain('unit_price');
    expect(keys).toContain('baseline');
    for (const forbidden of ['cost_unit_price', 'cost_amount', 'cost_total', 'sales_fee_rate', 'markup_rate', 'remark', 'standard_adjustment_reason', 'price_mode']) {
      expect(keys).not.toContain(forbidden);
    }
    // 公開中の Revision だけ
    expect(view).toContain("r.status = 'published'");
    expect(migration).toContain('grant execute on function public.get_standard_estimate_sale_views(uuid) to anon, authenticated;');
  });

  it('内部の関数は API から実行させない', () => {
    for (const internal of ['copy_standard_estimate_baseline', 'refresh_standard_estimate_baseline']) {
      expect(migration).toContain(`revoke all on function public.${internal}(`);
      expect(migration).not.toMatch(new RegExp(`grant execute on function public\\.${internal}\\(`));
    }
  });
});

describe('標準状態の商品（PR C1）：画面', () => {
  const actions = read('lib/actions/standard-estimates.ts');
  const page = read('app/admin/standard-estimates/[revisionId]/page.tsx');
  const editor = read('components/admin/standard-estimate-baseline-editor.tsx');

  it('登録は本部だけで、価格・区分は DB に決めさせる（画面からは商品・数量・選択肢だけを送る）', () => {
    expect(actions).toContain("rpc('set_standard_estimate_baseline'");
    expect(actions).not.toMatch(/\.from\('standard_estimate_revision_baseline_(items|variants)'\)[\s\S]{0,120}\.(insert|update|delete|upsert)\(/);
    expect(editor).toContain('variant_choice_ids');
    expect(editor).not.toContain('unit_price_snapshot:');
  });

  it('公開済みは読み取り専用で、保存後は DB の内容で作り直す', () => {
    expect(page).toContain('readOnly={!isDraft}');
    expect(page).toContain('key={`baseline-${revision.lock_version}`}');
    expect(editor).toContain('router.refresh()');
  });
});
