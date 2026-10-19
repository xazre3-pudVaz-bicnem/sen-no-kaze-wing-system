import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20261019100000_standard_estimate_v25_revisions.sql');
const check = read('scripts/db-rehearsal/check.mjs');
const runtimeSql = read('scripts/db-rehearsal/runtime-standard-estimate-v25.sql');
const runtimeRace = read('scripts/db-rehearsal/runtime-standard-estimate-v25.mjs');

const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

function functionBody(name: string) {
  const start = sqlOnly.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(0);
  const bodyStart = sqlOnly.indexOf('as $$', start);
  const bodyEnd = sqlOnly.indexOf('$$;', bodyStart + 5);
  return sqlOnly.slice(start, bodyEnd);
}

describe('v2.5 PR-B1：標準見積の v2.5 の Revision', () => {
  it('PR-A1・A2 の後に 1 つの transaction で適用し、既存の Revision は v2.5 以前の計算のまま変えない', () => {
    expect(sqlOnly.trimStart().startsWith('begin;')).toBe(true);
    expect(sqlOnly.trimEnd().endsWith('commit;')).toBe(true);
    expect(sqlOnly).toContain("set local lock_timeout = '5s';");
    expect(sqlOnly).toContain("to_regprocedure('public.pricing_calculate(uuid, uuid, jsonb)') is null");
    expect(sqlOnly).toContain("add column pricing_model text not null default 'legacy'");
    expect(sqlOnly).toContain("if exists (select 1 from public.standard_estimate_revisions r where r.pricing_model <> 'legacy') then");
    // 既存の表のデータを書き換える文を持たない（v2.5 の下書きは RPC を呼んだときだけできる）
    expect(sqlOnly).not.toMatch(/^\s*update public\.standard_estimate_revisions\s+set pricing_model/m);
  });

  it('v2.5 の Revision は計算ルール・税ルールを固定し、公開したものは原価がそろい計算結果を持つ', () => {
    expect(sqlOnly).toContain('add column calc_rule_version_id uuid references public.pricing_calculation_rule_versions(id) on delete restrict');
    expect(sqlOnly).toContain('add column tax_rule_version_id uuid references public.tax_rule_versions(id) on delete restrict');
    expect(sqlOnly).toContain("pricing_model <> 'v2.5' or status = 'draft' or (v25_pricing_complete and v25_calc_result is not null)");
  });

  it('商品の選択枠は標準状態の商品の行に価格方式と原価 Version の固定を持ち、固定は同じ商品・同じ選択肢の Version だけ', () => {
    expect(sqlOnly).toContain('foreign key (standard_cost_version_id, option_id)');
    expect(sqlOnly).toContain('references public.option_standard_cost_versions (id, option_id) on delete restrict');
    expect(sqlOnly).toContain('foreign key (variant_cost_version_id, variant_choice_id)');
    expect(sqlOnly).toContain('references public.option_variant_cost_versions (id, variant_choice_id) on delete restrict');
    expect(sqlOnly).toContain("check (price_mode is null or price_mode in ('auto', 'manual', 'por'))");
    // por は金額を持たず、manual は売価を必須にする
    expect(sqlOnly).toContain("(price_mode = 'por' and standard_cost_version_id is null and manual_unit_price is null");
    expect(sqlOnly).toContain("(price_mode = 'manual' and manual_unit_price is not null and manual_unit_price >= 0");
  });

  it('商品に紐づかない明細は manual と por だけ（商品台帳の商品は選択枠で持つ）。公開済みは変えない', () => {
    expect(sqlOnly).toContain('create table public.standard_estimate_revision_v25_lines');
    expect(sqlOnly).toContain("price_mode text not null check (price_mode in ('manual', 'por'))");
    expect(sqlOnly).toContain("(price_mode = 'por' and unit_price is null and amount is null)");
    expect(sqlOnly).toContain('review_required boolean not null default false');
    expect(sqlOnly).toMatch(/create trigger standard_estimate_revision_v25_lines_draft_only\s+before insert or update or delete on public\.standard_estimate_revision_v25_lines\s+for each row execute function public\.prevent_non_draft_standard_estimate_child_write\(\);/);
    expect(sqlOnly).toContain('alter table public.standard_estimate_revision_v25_lines enable row level security;');
    expect(sqlOnly).toContain('revoke all on table public.standard_estimate_revision_v25_lines from public, anon, authenticated, service_role;');
    expect(sqlOnly).toContain('using (public.can_view_standard_estimate_revision(revision_id));');
  });

  it('v2.5 の Revision は v2.5 の RPC からだけ変更でき、旧来の処理では変えられない', () => {
    const guard = functionBody('standard_estimate_v25_revision_guard');
    expect(guard).toContain("if (old.pricing_model = 'v2.5' or new.pricing_model = 'v2.5') and not v_writer then");
    expect(guard).toContain("if old.pricing_model = 'v2.5' and new.pricing_model <> 'v2.5' then");
    // v2.5 で公開した標準見積では、旧来の下書き・次の Revision を作れない
    expect(guard).toContain("if new.pricing_model = 'legacy' and exists (");
    const child = functionBody('standard_estimate_v25_child_guard');
    expect(child).toContain("tg_table_name = 'standard_estimate_revision_lines' and v_model = 'v2.5' and tg_op <> 'DELETE'");
    for (const table of ['standard_estimate_revision_sections', 'standard_estimate_revision_lines', 'standard_estimate_revision_baseline_items',
      'standard_estimate_revision_baseline_variants', 'standard_estimate_revision_v25_lines']) {
      expect(sqlOnly).toContain(`before insert or update or delete on public.${table}\nfor each row execute function public.standard_estimate_v25_child_guard();`);
    }
    expect(functionBody('standard_estimate_v25_set_writer')).toContain("pg_catalog.set_config('wing.standard_estimate_v25_writer', case when p_on then 'on' else '' end, true)");
  });

  it('原価 Version は同じ商品・同じ選択肢なら引き継ぎ（黙って更新しない）、変えたときと最新原価の取り込みだけ固定し直す', () => {
    const save = functionBody('save_standard_estimate_v25_draft');
    expect(save).toContain("v_prev := case when v_mode = 'auto' then v_old -> v_identity end;");
    expect(save).toContain("when v_reuse then (v_prev ->> 'cost_pin')::uuid");
    expect(save).toContain('else (select v.id from public.option_standard_cost_versions v where v.option_id = o.id and v.superseded_at is null)');
    const refresh = functionBody('refresh_standard_estimate_v25_costs');
    expect(refresh).toContain("where b.revision_id = rev.id and b.price_mode = 'auto';");
    expect(refresh).toContain('calc_rule_version_id = v_calc_rule');
    // 次の Revision へは固定をそのまま写す
    expect(functionBody('standard_estimate_v25_copy_slots')).toContain("when v_from_model = 'v2.5' then b.standard_cost_version_id");
  });

  it('原価が未設定の選択枠は 0 円にせず計算から外して挙げ、公開では止める', () => {
    const input = functionBody('standard_estimate_v25_calc_input');
    expect(input).toContain("if b.standard_cost_version_id is null or v_missing_variant then");
    expect(input).toContain("'reason', case when b.standard_cost_version_id is null then 'missing_standard_cost' else 'missing_variant_cost' end");
    expect(input).toContain('continue;');
    expect(functionBody('standard_estimate_v25_recalculate')).toContain('if p_require_complete and pg_catalog.jsonb_array_length(v_incomplete) > 0 then');
  });

  it('金額は正式計算で作り、行の CHECK を途中で破らないよう調整額・税率は合計と同じ 1 文で書く', () => {
    const recalc = functionBody('standard_estimate_v25_recalculate');
    expect(recalc).toContain("v_result := public.pricing_calculate(rev.calc_rule_version_id, rev.tax_rule_version_id, v_built -> 'input');");
    expect(recalc).toMatch(/set standard_adjustment_amount = v_adjustment,\s+standard_adjustment_reason = v_reason,\s+tax_rate = v_tax_rate,\s+subtotal_raw = v_sections_total,/);
    expect(recalc).toContain("v25_calc_result = pg_catalog.jsonb_build_object('calc', v_result, 'incomplete', v_incomplete)");
    expect(recalc).not.toMatch(/\bround\s*\(|\bfloor\s*\(/i);
  });

  it('「要見直し」の明細が残っていれば、公開の RPC で止め、編集画面の確認でも公開できないと返す（2026-10-19 の確定方針）', () => {
    const publish = functionBody('publish_standard_estimate_v25_revision');
    expect(publish).toContain('if exists (select 1 from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id and l.review_required) then');
    expect(publish.indexOf('l.review_required) then')).toBeLessThan(publish.indexOf('perform public.standard_estimate_v25_recalculate(rev.id, true);'));
    const preview = functionBody('preview_standard_estimate_v25_revision');
    expect(preview).toContain("'review_required_lines', v_review_lines,");
    expect(preview).toContain('and v_review_lines = 0');
  });

  it('別途工事は自動計算にさせない：保存で拒否し、v2.5 以前からは別途見積（POR）として写す', () => {
    const save = functionBody('save_standard_estimate_v25_draft');
    expect(save).toContain("if v_mode = 'auto' and not (v_section_of_slot = any(coalesce(v_auto_sections, '{}'::text[]))) then");
    expect(save).toContain('別途工事の商品は自動計算（販売費・掛率）にできません');
    expect(functionBody('standard_estimate_v25_copy_lines')).toContain("case when l.price_mode = 'por' or l.section_code = 'sitework' then 'por' else 'manual' end");
    expect(functionBody('standard_estimate_v25_copy_slots')).toContain("when b.section_code = any(coalesce(v_auto_sections, '{}'::text[])) then 'auto'");
    expect(functionBody('start_standard_estimate_v25_draft')).toContain("set price_mode = 'por'");
  });

  it('公開は Revision → 標準見積 → 商品の行（FOR SHARE）の順に lock し、排他の後に原価・ルールの新しさを確かめる', () => {
    const publish = functionBody('publish_standard_estimate_v25_revision');
    const revisionLock = publish.indexOf('from public.standard_estimate_revisions r where r.id = p_revision_id for update;');
    const masterLock = publish.indexOf('from public.standard_estimate_masters sm where sm.id = rev.standard_estimate_master_id for update;');
    const optionLock = publish.indexOf('for share;');
    const freshness = publish.indexOf('or v.superseded_at is not null');
    const recalc = publish.indexOf('perform public.standard_estimate_v25_recalculate(rev.id, true);');
    const statusUpdate = publish.indexOf("set status = 'published'");
    expect(revisionLock).toBeGreaterThan(0);
    expect(masterLock).toBeGreaterThan(revisionLock);
    expect(optionLock).toBeGreaterThan(masterLock);
    expect(freshness).toBeGreaterThan(optionLock);
    expect(recalc).toBeGreaterThan(freshness);
    expect(statusUpdate).toBeGreaterThan(recalc);
    expect(publish).toContain('r.superseded_at is null');
    expect(publish).toContain('perform public.refresh_standard_estimate_baseline(rev.id);');
  });

  it('旧来の下書きの切り替えは画面が読んだ版と一致したときだけ。公開済みの Revision は土台にするだけで変えない', () => {
    const start = functionBody('start_standard_estimate_v25_draft');
    expect(start).toContain('if p_expected_draft_lock_version is distinct from d.lock_version then');
    expect(start).toContain('perform public.standard_estimate_v25_copy_lines(d.id, d.id, true);');
    expect(start).toContain("perform public.standard_estimate_v25_copy_lines(cur.id, v_rev, cur.pricing_model = 'legacy');");
    expect(functionBody('standard_estimate_v25_copy_lines')).toContain("l.remark, true, l.sort_order");
  });

  it('シミュレーターの売価の取得・標準見積から作る見積は、v2.5 の Revision をまだ扱わない（PR-C1・D1 で対応）', () => {
    expect(sqlOnly).toContain("and r.status = ''published'' and r.pricing_model = ''legacy''");
    expect(sqlOnly).toContain("raise exception 'STANDARD_ESTIMATE_V25: % differs from the reviewed definition (anchor is not unique)'");
    expect(sqlOnly).toMatch(/create trigger quote_drafts_v25_standard_estimate_guard\s+before insert or update of standard_estimate_revision_id on public\.quote_drafts/);
  });

  it('RPC は SECURITY DEFINER・空の search_path・authenticated だけ。内部の関数は API のどの role からも実行できない', () => {
    const rpcs = ['start_standard_estimate_v25_draft(uuid, integer, uuid)', 'save_standard_estimate_v25_draft(uuid, integer, jsonb)',
      'refresh_standard_estimate_v25_costs(uuid, integer)', 'publish_standard_estimate_v25_revision(uuid, integer)',
      'preview_standard_estimate_v25_revision(uuid)'];
    for (const fn of rpcs) {
      expect(sqlOnly).toContain(`grant execute on function public.${fn} to authenticated;`);
      expect(sqlOnly).toContain(`alter function public.${fn} owner to postgres;`);
    }
    for (const fn of ['standard_estimate_v25_calc_input(uuid, integer)', 'standard_estimate_v25_recalculate(uuid, boolean, integer, text)',
      'standard_estimate_v25_copy_slots(uuid, uuid)', 'standard_estimate_v25_copy_lines(uuid, uuid, boolean)',
      'standard_estimate_v25_set_writer(boolean)', 'standard_estimate_v25_writer_active()']) {
      expect(sqlOnly).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
      expect(sqlOnly).not.toContain(`grant execute on function public.${fn}`);
    }
    for (const name of ['start_standard_estimate_v25_draft', 'save_standard_estimate_v25_draft', 'refresh_standard_estimate_v25_costs',
      'publish_standard_estimate_v25_revision', 'preview_standard_estimate_v25_revision']) {
      const body = functionBody(name);
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
      expect(body).toContain('v_uid uuid := auth.uid();');
      // 権限は状態の判定より前に確認する
      const permission = body.search(/can_(edit|view)_standard_estimate_(master|revision)/);
      const status = body.indexOf("rev.status <> 'draft'");
      expect(permission).toBeGreaterThan(0);
      if (status > 0) expect(permission).toBeLessThan(status);
    }
  });

  it('実 DB の検査（1 接続・2 接続の同時実行）を check.mjs に登録し、1 接続の検査は rollback する', () => {
    expect(check).toContain("import { runtimeStandardEstimateV25 } from './runtime-standard-estimate-v25.mjs';");
    expect(check).toContain('await runtimeStandardEstimateV25(client, { connectionString: url })');
    expect(runtimeSql.trimEnd().endsWith('rollback;')).toBe(true);
    expect(runtimeRace).toContain('waitUntilBlocked');
    expect(runtimeRace).toContain('cleanupFixture');
    expect(runtimeRace).toContain('原価の切替が先');
    expect(runtimeRace).toContain('公開が先');
    expect(runtimeRace).toContain('保存が先');
  });
});
