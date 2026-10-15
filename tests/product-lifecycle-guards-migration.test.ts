import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// PR #500 の保存境界（20261015113000）。実際の動作は scripts/db-rehearsal/runtime-product-lifecycle*.mjs で
// 空の DB に適用して確かめる。ここでは、適用順・権限・既存関数との差分が崩れていないかを静的に確かめる。

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const columns = read('supabase/migrations/20261015110000_product_lifecycle_retired_simulator_visibility.sql');
const guards = read('supabase/migrations/20261015113000_product_lifecycle_guards.sql');
const previousValidate = read('supabase/migrations/20261013122000_customer_spec_required_history_corrective.sql');

/** `create [or replace] function public.<name>(` から、その関数の本文の終わり（`$$;`）まで */
function functionSource(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, `${name} が見つからない`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end + 4);
}

/** 関数の本文（as $$ 〜 $$;）から空行を除いたもの（書式の違いを無視して比べる） */
function bodyLines(source: string): string[] {
  return source
    .slice(source.indexOf('as $$'))
    .split('\n')
    .filter((line) => line.trim() !== '');
}

const GUARD_TRIGGERS: [table: string, trigger: string, events: string][] = [
  ['options', 'options_lifecycle_guard', 'before update of archived_at, simulator_visible'],
  ['configuration_items', 'configuration_items_lifecycle_stash', 'before delete'],
  ['configuration_items', 'configuration_items_lifecycle_guard', 'before insert or update of option_id, quantity, variant_choice_ids'],
  ['configurations', 'configurations_exterior_lifecycle_guard', 'before insert or update of exterior_faces'],
  ['quote_requests', 'quote_requests_lifecycle_guard', 'before insert'],
  ['quote_items', 'quote_items_lifecycle_guard', 'before insert'],
  ['quote_draft_items', 'quote_draft_items_lifecycle_stash', 'before delete'],
  ['quote_draft_items', 'quote_draft_items_lifecycle_guard', 'before insert or update of option_id, quantity, line_key'],
  ['standard_estimate_revision_baseline_items', 'standard_estimate_baseline_lifecycle_stash', 'before delete'],
  ['standard_estimate_revision_baseline_items', 'standard_estimate_baseline_lifecycle_guard', 'before insert or update of option_id, quantity'],
  ['standard_estimate_revision_baseline_variants', 'standard_estimate_baseline_variant_lifecycle_guard', 'before insert'],
  ['standard_estimate_revisions', 'standard_estimate_publish_lifecycle_guard', 'before update of status'],
  ['estimate_templates', 'estimate_templates_lifecycle_guard', 'before insert or update of baseline_option_ids'],
];

describe('商品の取扱終了・シミュレーター表示の保存境界（20261015113000）', () => {
  it('列の migration（20261015110000）の後に、1 つのトランザクションで適用し、lock を長く待たない', () => {
    expect(columns).toContain('add column if not exists simulator_visible boolean not null default true');
    expect(columns).toContain('add column if not exists archived_at timestamp with time zone');
    expect(guards).toContain("raise exception 'PRECONDITION: product lifecycle columns (20261015110000) must be applied first'");
    expect(guards.trimStart().indexOf('begin;')).toBeLessThan(guards.indexOf("set local lock_timeout = '5s';"));
    expect(guards.indexOf("set local lock_timeout = '5s';")).toBeLessThan(guards.indexOf('do $preflight$'));
    expect(guards.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('既存データを書き換えない（表の変更・データの追加・更新・削除をしない）', () => {
    expect(guards).not.toMatch(/\balter\s+table\b/i);
    expect(guards).not.toMatch(/\binsert\s+into\b/i);
    expect(guards).not.toMatch(/\bupdate\s+public\.\w+\s+set\b/i);
    expect(guards).not.toMatch(/\bdelete\s+from\b/i);
    expect(guards).not.toMatch(/\btruncate\b/i);
    expect(guards).not.toMatch(/\bdrop\s+(table|function|trigger|policy)\b/i);
  });

  it('到達できる保存・提出・発行の経路すべてに、行のトリガーを付ける', () => {
    for (const [table, trigger, events] of GUARD_TRIGGERS) {
      expect(guards).toContain(`create trigger ${trigger}\n${events} on public.${table}\nfor each row execute function public.${trigger}();`);
      expect(guards).toContain(`'${table}.${trigger}'`);
    }
    expect(guards).toContain("raise exception 'POSTCONDITION: trigger % is missing', v_trigger;");
  });

  it('判定の部品とトリガーは利用者から呼ばせず、画面の機能判定だけをログインした利用者に許す', () => {
    const internal = [...guards.matchAll(/^create function public\.(\w+)\(/gm)].map((m) => m[1]);
    expect(internal).toContain('product_lifecycle_stash_take');
    expect(internal).toContain('product_lifecycle_capability');
    for (const name of internal) {
      expect(guards).toMatch(new RegExp(`alter function public\\.${name}\\([^)]*\\) owner to postgres;`));
      expect(guards).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated, service_role;`));
    }
    const grants = [...guards.matchAll(/^grant execute on function public\.(\w+)\(/gm)].map((m) => m[1]);
    expect(grants).toEqual(['product_lifecycle_capability']);
    expect(guards).toContain("raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;");
    expect(guards).toContain("raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;");
  });

  it('既存関数は validate_configuration_items だけを置き換え、main の最新定義（20261013122000）から必須カテゴリーの判定だけを変える', () => {
    const replaced = [...guards.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(replaced).toEqual(['validate_configuration_items']);

    const before = bodyLines(functionSource(previousValidate, 'validate_configuration_items'));
    const after = bodyLines(functionSource(guards, 'validate_configuration_items'));
    const added = after.filter((line) => !before.includes(line));
    const removed = before.filter((line) => !after.includes(line));
    expect(added.map((line) => line.trim())).toEqual(['and o.archived_at is null and o.simulator_visible']);
    expect(removed).toEqual([]);
    // 画面の文言の対応（mapPgError）に使う接頭辞と文言は変えない
    for (const message of [
      "'CONFLICT: %'",
      "'DEPENDENCY: %'",
      "'REQUIRED: 「%」は選択された注文範囲に含まれません'",
      "'REQUIRED: 「%」を選択してください'",
      "'SINGLE: 「%」は 1 つだけ選択してください'",
    ]) {
      expect(after.join('\n')).toContain(message);
    }
    expect(guards).toContain('revoke all on function public.validate_configuration_items(uuid, uuid[], text) from public, anon, authenticated, service_role;');
  });

  it('シミュレーター非表示だけでは、見積依頼・見積の発行・標準見積の公開を止めない（取扱終了だけを止める）', () => {
    for (const name of ['quote_requests_lifecycle_guard', 'quote_items_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard']) {
      const source = functionSource(guards, name);
      expect(source).not.toContain('simulator_visible');
      expect(source).toContain("= 'retired'");
      expect(source).toContain('RETIRED:');
    }
  });

  it('取扱終了は、公開中の標準見積・Excel 標準の基準商品・必須・初期選択・前提商品・本体の仕様で使われていれば止める（fail closed）', () => {
    const source = functionSource(guards, 'options_lifecycle_guard');
    for (const reference of [
      'standard_estimate_revision_baseline_items',
      'estimate_templates',
      'is_required',
      'is_default',
      'option_dependencies',
      'presets',
    ]) {
      expect(source).toContain(reference);
    }
    expect(source).toContain('LOCKED:');
  });
});
