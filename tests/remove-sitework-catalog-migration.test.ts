import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A-3（2026-11-04 先方回答）の削除の migration の作り。実際の削除・止める条件・写しからの戻し方は
 * 実 DB の検査（scripts/db-rehearsal/runtime-a3-remove-sitework.sql）で確かめる
 */
const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261104110000_remove_sitework_catalog.sql'), 'utf8');
const fn = sql.slice(sql.indexOf('create function public.remove_sitework_catalog'), sql.indexOf('$remove$;'));

describe('別途工事 9 品目の削除の migration', () => {
  it('v2.5 の後に 1 回だけ適用する（前の確認・トランザクション）', () => {
    expect(sql.trimStart().startsWith('--')).toBe(true);
    expect(sql).toContain('begin;');
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain("PRECONDITION: v2.5 (20261016200000 〜 20261102140000) must be applied first");
    expect(sql).toContain('PRECONDITION: A-3 objects already exist');
  });

  it('初期明細の表は担当者だけが読み、書き換えは migration だけ', () => {
    expect(sql).toContain('create table public.quote_initial_lines');
    expect(sql).toContain('alter table public.quote_initial_lines enable row level security;');
    expect(sql).toContain('revoke all on table public.quote_initial_lines from public, anon, authenticated, service_role;');
    expect(sql).toContain('grant select on table public.quote_initial_lines to authenticated, service_role;');
    expect(sql).toContain('using (coalesce(public.current_role_rank(), 0) >= 1)');
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*quote_initial_lines/i);
  });

  it('消す行は非公開のスキーマへ写してから消し、写しは API のロールから使えない', () => {
    expect(sql).toContain('create schema archive_a3_20261104;');
    expect(sql).toContain('revoke all on schema archive_a3_20261104 from public, anon, authenticated, service_role;');
    for (const table of ['option_categories', 'options', 'configurations', 'configuration_items', 'configuration_snapshots', 'quote_requests', 'quotes', 'quote_items', 'quote_documents']) {
      expect(sql).toContain(`create table archive_a3_20261104.${table} as select * from public.${table} with no data;`);
      expect(fn).toContain(`('${table}', 'x.`);
    }
    // 写しの表の列だけを名前で写す（後の migration が元の表に列を足しても動く。2026-11-05 の統合リハーサルで、
    // ⑥・代理店の拡張・C-4 を適用した後に呼ぶと select * では列の数が合わなくなることが分かったため）
    expect(fn).not.toMatch(/insert into archive_a3_20261104\.\w+ select \*/);
    const copy = "execute pg_catalog.format('insert into archive_a3_20261104.%I (%s) select %s from public.%I x where %s',";
    expect(fn).toContain(copy);
    expect(fn).toContain("where a.attrelid = pg_catalog.to_regclass('archive_a3_20261104.' || v_copy.tbl) and a.attnum > 0 and not a.attisdropped;");
    expect(fn).toContain('using v_cat, v_products, v_cfg, v_req, v_quote;');
    // 写しは消す前
    expect(fn.indexOf(copy)).toBeLessThan(fn.indexOf('delete from public.quote_requests'));
    expect(fn.indexOf(copy)).toBeLessThan(fn.indexOf('delete from public.configurations'));
    expect(fn.indexOf(copy)).toBeLessThan(fn.indexOf('delete from public.options'));
  });

  it('削除の関数は内部用（所有者 postgres・API のロールから実行できない・search_path を固定）', () => {
    expect(fn).toContain("set search_path = ''");
    expect(fn).not.toContain('security definer');
    expect(sql).toContain('alter function public.remove_sitework_catalog(jsonb) owner to postgres;');
    expect(sql).toContain('revoke all on function public.remove_sitework_catalog(jsonb) from public, anon, authenticated, service_role;');
  });

  it('対象は件数と ID の並びの md5 で照合し、違えば止める（9 品目の無い DB では何もしない）', () => {
    expect(fn).toContain("return pg_catalog.jsonb_build_object('skipped', true);");
    expect(fn).toContain('v_actual is distinct from p_expected');
    expect(fn).toContain('A3_STOP: 削除の対象（プラン・見積依頼・見積）が確認のときと違うため止めました');
    // 本番の照合値（2026-11-04 14:34 の読み取り。プラン 18・見積依頼 10・見積 10）
    expect(sql).toContain("'configurations', pg_catalog.jsonb_build_object('count', 18, 'md5', '052ab4ee62f1a393d616a2e759c200c5')");
    expect(sql).toContain("'quote_requests', pg_catalog.jsonb_build_object('count', 10, 'md5', 'c26addc61c32672f79dc7ddf8089aa56')");
    expect(sql).toContain("'quotes', pg_catalog.jsonb_build_object('count', 10, 'md5', '7640ea6300fe17b4b8b996e8c8c52284')");
  });

  it('止める条件：対象につながる記録・対象の外からの利用・カテゴリーのほかの商品・削除の後の件数', () => {
    for (const table of ['contracts', 'manufacturing_orders', 'quote_por_confirmations', 'quote_drafts', 'quote_change_requests', 'quote_internal_snapshots',
                         'quote_item_cost_pins', 'case_workflows', 'site_surveys', 'disaster_consents', 'stock_ledger_entries']) {
      expect(fn).toContain(`from public.${table} x`);
    }
    for (const table of ['quote_draft_items', 'standard_estimate_revision_baseline_items', 'standard_estimate_revision_slot_options',
                         'option_standard_cost_versions', 'option_hq_standard_costs', 'guest_plans']) {
      expect(fn).toContain(`from public.${table}`);
    }
    expect(fn).toContain('A3_STOP: 別途工事のカテゴリーに 9 品目以外の商品がある');
    expect(fn).toContain('A3_STOP: 削除の後の件数が想定と違うため止めました');
  });

  it('消す順：見積依頼（見積が一緒に消える）→ 残りの見積 → プラン → 標準構成 → 9 品目 → カテゴリー（見積はプランも参照するため、プランより先に消す）', () => {
    const order = ['delete from public.quote_requests', 'delete from public.quotes', 'delete from public.configurations', 'update public.base_models bm', 'delete from public.options', 'delete from public.option_categories'].map((s) => fn.indexOf(s));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('適用の後の確認：9 品目とカテゴリーが無く、初期明細が 9 件ある', () => {
    expect(sql).toContain('POSTCONDITION: sitework catalog must be removed');
    expect(sql).toContain('POSTCONDITION: the 9 initial sitework lines must exist');
  });
});
