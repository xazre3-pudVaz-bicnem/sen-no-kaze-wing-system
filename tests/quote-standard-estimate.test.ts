import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { quoteLineAmount } from '@/lib/domain/quote-amount';
import {
  previewStandardQuote,
  standardQuoteStateFromPayload,
  toStandardQuoteSaveLines,
  type StandardQuoteDraftPayload,
  type StandardQuoteEditorState,
} from '@/lib/domain/standard-quote-view';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013180000_quote_standard_estimate_money.sql');
const methods = { base: 'rate', interior_exterior: 'rate', option: 'rate', sitework: 'none' } as const;

// 実 DB の実行時検査（runtime-security.sql の 15-3・15-9）と同じ入力
const created: StandardQuoteEditorState = {
  sales_fee_rate: '1.07',
  expense_rate: '0.15',
  markup_rate: '1.5',
  expense_methods: { ...methods },
  adjustment: -719,
  adjustment_reason: '端数調整',
  notes: '',
  lines: [
    { line_key: 'b1', section_code: 'base', name: '伸縮脚', description: '1．金物', quantity: '12', unit: '本', price_mode: 'auto', base_unit_cost: 18200, cost_unit_price: null, unit_price: null, remark: null },
    { line_key: 'o1', section_code: 'option', name: '洗面器', description: null, quantity: '1', unit: null, price_mode: 'auto', base_unit_cost: null, cost_unit_price: 46150, unit_price: null, remark: null },
    { line_key: 'o2', section_code: 'option', name: '未定の備品', description: null, quantity: '1', unit: null, price_mode: 'por', base_unit_cost: null, cost_unit_price: null, unit_price: null, remark: null },
  ],
};
const saved: StandardQuoteEditorState = {
  ...created,
  adjustment: -756,
  lines: [
    created.lines[0],
    created.lines[1],
    { ...created.lines[2], price_mode: 'manual', cost_unit_price: 500, unit_price: 900 },
    { line_key: null, section_code: 'sitework', name: '据付', description: null, quantity: '2.5', unit: 'm', price_mode: 'manual', base_unit_cost: null, cost_unit_price: 999, unit_price: 2001, remark: null },
  ],
};

describe('標準見積から作成した見積：試算（DB と同じ式）', () => {
  it('作成直後は標準見積と同じ合計で、POR は合計に含めない（経費は率から計算し直す）', () => {
    const preview = previewStandardQuote(created, '0.10');
    expect(preview.errors).toEqual([]);
    expect(preview.money).toMatchObject({ subtotal: 482000, tax: 48200, total: 530200, costTotal: 321813, hasPor: true });
    // 本体：trunc(18,200 × 1.07) = 19,474 → trunc(19,474 × 1.5) = 29,211 → × 12
    expect(preview.lines[0]).toMatchObject({ costUnitPrice: 19474, saleUnitPrice: 29211, saleAmount: 350532 });
    expect(preview.sections.base).toMatchObject({ saleExpense: 52579, costExpense: 35053 });
    expect(preview.sections.option.hasPor).toBe(true);
  });

  it('保存後の金額は DB と同じ（別途工事 2.5 m × 2,001 円は trunc で 5,002 円、経費なし）', () => {
    const preview = previewStandardQuote(saved, '0.10');
    expect(preview.errors).toEqual([]);
    expect(preview.money).toMatchObject({ subtotal: 488000, tax: 48800, total: 536800, costTotal: 324885, grossProfit: 163115, hasPor: false });
    expect(preview.lines[3]).toMatchObject({ saleAmount: 5002, costAmount: 2497 });
    expect(preview.sections.sitework).toMatchObject({ saleExpense: 0, saleTotal: 5002 });
  });

  it('率が範囲外・数量が見積のルール外なら試算しない', () => {
    expect(previewStandardQuote({ ...saved, markup_rate: '2.6' }, '0.10').money).toBeNull();
    const tooSmall = previewStandardQuote({ ...saved, lines: [{ ...saved.lines[1], quantity: '0.005' }] }, '0.10');
    expect(tooSmall.money).toBeNull();
    expect(tooSmall.errors[0]).toContain('1行目');
  });

  it('保存で送るのは単価と方法だけ（本体マスター由来の行の原価・POR の単価・manual 以外の売価は送らない）', () => {
    const lines = toStandardQuoteSaveLines(saved.lines);
    expect(lines[0]).toMatchObject({ line_key: 'b1', section_code: 'base', cost_unit_price: null, unit_price: null });
    expect(lines[0]).not.toHaveProperty('base_unit_cost');
    expect(lines[1]).toMatchObject({ price_mode: 'auto', cost_unit_price: 46150, unit_price: null });
    expect(lines[2]).toMatchObject({ price_mode: 'manual', cost_unit_price: 500, unit_price: 900 });
    expect(toStandardQuoteSaveLines(created.lines)[2]).toMatchObject({ price_mode: 'por', cost_unit_price: null, unit_price: null });
  });

  it('RPC の返り値から画面を作るとき、経費の行（DB が作り直す）は明細に入れない', () => {
    const payload = {
      draft: { id: 'd', quote_request_id: 'r', parent_quote_id: null, base_model_id: 'm', spec_code: 'hotel', tax_rate: '0.10', adjustment: -719, adjustment_reason: '端数調整', subtotal: 482000, tax: 48200, total: 530200, lock_version: 1, notes: null, source_kind: 'standard_estimate', standard_estimate_revision_id: 's' },
      request: { id: 'r', case_name: null, status: 'reviewing', message: null, contact: { full_name: '検査 太郎' } },
      internals: { sales_fee_rate: '1.0700', expense_rate: '0.1500', markup_rate: '1.5000', expense_methods: { ...methods }, cost_total: 321813 },
      items: [
        { line_key: 'b1', kind: 'base', name: '伸縮脚', description: '1．金物', unit: '本', remark: null, unit_price: 29211, quantity: 12, amount: 350532, sort_order: 1001, price_mode: 'auto', section_code: 'base', line_role: 'line', base_unit_cost: 18200, cost_unit_price: 19474, cost_amount: 233688 },
        { line_key: 'e1', kind: 'base_expense', name: '本体諸費用', description: null, unit: '式', remark: null, unit_price: 52579, quantity: 1, amount: 52579, sort_order: 1999, price_mode: 'auto', section_code: 'base', line_role: 'expense', base_unit_cost: null, cost_unit_price: 35053, cost_amount: 35053 },
        { line_key: 'o2', kind: 'option', name: '未定の備品', description: null, unit: null, remark: null, unit_price: null, quantity: 1, amount: null, sort_order: 3002, price_mode: 'por', section_code: 'option', line_role: 'line', base_unit_cost: null, cost_unit_price: null, cost_amount: null },
      ],
      standard_estimate: null,
      parent: null,
    } satisfies StandardQuoteDraftPayload;
    const state = standardQuoteStateFromPayload(payload);
    expect(state.lines.map((line) => line.line_key)).toEqual(['b1', 'o2']);
    expect(state.lines[0]).toMatchObject({ base_unit_cost: 18200, cost_unit_price: null });
    expect(state).toMatchObject({ sales_fee_rate: '1.0700', markup_rate: '1.5000', adjustment: -719 });
  });

  it('手入力の見積の明細額も trunc（浮動小数点の誤差で 1 円ずれない）', () => {
    expect(quoteLineAmount(2001, 2.5)).toBe(5002);
    expect(quoteLineAmount(100, 1.15)).toBe(115);
    expect(quoteLineAmount(1999, 0.333)).toBe(665);
  });
});

describe('標準見積から作成した見積：DB の取り決め（migration）', () => {
  it('内部原価は専用の表に置き、quotes / quote_items には原価の列を足さない', () => {
    expect(migration).toContain('create table public.quote_draft_internals (');
    expect(migration).toContain('create table public.quote_draft_item_costs (');
    expect(migration).toContain('create table public.quote_internal_snapshots (');
    expect(migration).not.toMatch(/alter table public\.quote_items\b/);
    expect(migration).not.toMatch(/alter table public\.quotes\b/);
    // 下書きの内部原価は RPC だけ。発行済みの内部原価は本部だけが読める
    expect(migration).toContain('using (public.current_role_rank() >= 3);');
    expect(migration).toContain('grant select on public.quote_internal_snapshots to authenticated;');
    expect(migration).not.toMatch(/grant [a-z, ]+ on (table )?public\.quote_draft_(internals|item_costs)[^;]* to (anon|authenticated)/);
  });

  it('POR は下書きで使えるが、発行（初回・改訂とも）では拒否する', () => {
    expect(migration).toContain("(price_mode = 'por' and unit_price is null and amount is null)");
    expect(migration.match(/価格未確定（POR）の明細が残っています/g)).toHaveLength(2);
    expect(migration.match(/por\.price_mode = ''por'' or por\.unit_price is null or por\.amount is null/g)).toHaveLength(2);
  });

  it('既存の見積処理は、適用済みの定義を検査してから置き換える（目印はちょうど 1 箇所）', () => {
    for (const signature of [
      'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)',
      'public.finalize_quote_draft(uuid, integer)',
      'public.finalize_quote_revision_draft(uuid, integer)',
      'public.create_quote_revision_draft(uuid)',
    ]) {
      expect(migration).toContain(`v_signature constant text := '${signature}';`);
    }
    expect(migration.match(/anchor % is not unique/g)).toHaveLength(4);
    expect(migration.match(/owner \/ security definer \/ search_path \/ EXECUTE changed/g)).toHaveLength(4);
    expect(migration.match(/perform public\.write_quote_internal_snapshot\(d\.id, v_quote_id\);/g)).toHaveLength(2);
    expect(migration).toContain('perform public.prepare_quote_revision_draft(p_quote_id, v_draft_id);');
    expect(migration).toContain("E'    v_amount_numeric := trunc(v_unit_price_raw * v_qty);\\n'");
    expect(migration).toContain("E'    trunc(item.unit_price::numeric * item.quantity)::integer,\\n'");
  });

  it('置き換えの目印は、元の定義にちょうど 1 回ずつある', () => {
    const body = (file: string, name: string, tag: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const start = sql.indexOf(`create or replace function public.${name}(`);
      return sql.slice(start, sql.indexOf(`$${tag}$;`, start));
    };
    const once = (text: string, anchor: string) => text.split(anchor).length - 1;
    const lock = "  if d.lock_version is distinct from p_expected_lock_version then\n    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください'";
    const save = body('20261005050213_adjustment_reason_optional_corrective.sql', 'save_quote_draft', 'save_draft');
    expect(once(save, lock)).toBe(1);
    expect(once(save, '      v_amount_numeric := round(v_unit_price_raw * v_qty);\n')).toBe(1);
    expect(once(save, '      case when v_lock_parent_base then v_parent_item.amount else v_amount end,\n')).toBe(1);
    const finalize = body('20260929124500_unified_manual_quote_authoring.sql', 'finalize_quote_draft', 'finalize_draft');
    expect(once(finalize, lock)).toBe(1);
    expect(once(finalize, '    v_expected_amount := round(i.unit_price::numeric * i.quantity);\n')).toBe(1);
    expect(once(finalize, '    round(item.unit_price::numeric * item.quantity)::integer,\n')).toBe(1);
    expect(once(finalize, '  delete from public.quote_drafts\n   where id = d.id;\n')).toBe(1);
    const revision = body('20260928210000_non_web_quote_revision_draft_lifecycle.sql', 'finalize_quote_revision_draft', 'finalize_revision_draft');
    expect(once(revision, lock)).toBe(1);
    expect(once(revision, '      v_expected_amount := round(i.unit_price::numeric * i.quantity);\n')).toBe(1);
    expect(once(revision, '           or v_parent_item.amount is distinct from i.amount\n')).toBe(1);
    expect(once(revision, '  delete from public.quote_drafts\n   where id = d.id;\n')).toBe(1);
    const create = body('20260928210000_non_web_quote_revision_draft_lifecycle.sql', 'create_quote_revision_draft', 'create_revision_draft');
    expect(once(create, '  return v_draft_id;\n')).toBe(1);
  });

  it('標準見積の閲覧は本部だけ（原価・率の列があるため、代理店所属の経路を閉じる）', () => {
    const views = migration.slice(migration.indexOf('-- ---------- 標準見積の閲覧を本部だけにする ----------'), migration.indexOf('-- ---------- 計算（内部。API からは実行させない） ----------'));
    expect(views).toContain('create or replace function public.can_view_standard_estimate_master(');
    expect(views).toContain('create or replace function public.can_view_standard_estimate_revision(');
    expect(views).not.toContain('public.is_active_standard_estimate_staff()');
    expect(views.match(/owner_org\.organization_type = 'headquarters'/g)).toHaveLength(2);
  });

  it('作成・保存・内部原価の取得は本部だけで、計算の関数は API から実行させない', () => {
    for (const rpc of ['create_standard_quote_case', 'save_standard_quote_draft', 'get_standard_quote_draft']) {
      const start = migration.indexOf(`create function public.${rpc}(`);
      const fn = migration.slice(start, migration.indexOf('$;', migration.indexOf('as $', start)));
      expect(fn).toContain('if v_rank < 3 then');
      expect(fn.indexOf('if v_rank < 3 then')).toBeLessThan(fn.indexOf('select * into'));
    }
    expect(migration).toContain('grant execute on function public.create_standard_quote_case(text, jsonb, text, uuid) to authenticated;');
    for (const internal of ['apply_standard_quote_draft', 'materialize_standard_quote_draft', 'write_quote_internal_snapshot', 'prepare_quote_revision_draft']) {
      expect(migration).not.toMatch(new RegExp(`grant execute on function public\\.${internal}\\(`));
    }
  });
});

describe('標準見積から作成した見積：画面と権限', () => {
  const actions = read('lib/actions/standard-quotes.ts');
  const draftPage = read('app/admin/quotes/standard-drafts/[id]/page.tsx');
  const manualDraftPage = read('app/admin/quotes/drafts/[id]/page.tsx');

  it('操作は本部だけで、金額・経費の行・内部原価は DB の RPC に計算させる（表へ直接は書き込まない）', () => {
    expect(actions.match(/await requireAdmin\(/g)).toHaveLength(3);
    for (const rpc of ['create_standard_quote_case', 'save_standard_quote_draft', 'get_standard_quote_draft']) {
      expect(actions).toContain(`'${rpc}'`);
    }
    expect(actions).not.toMatch(/\.from\('(quote_drafts|quote_draft_items|quote_draft_internals|quote_draft_item_costs|quote_internal_snapshots)'\)/);
    expect(draftPage).toContain("rpc('get_standard_quote_draft'");
    expect(draftPage).toContain('key={draft.lock_version}');
  });

  it('手入力の編集画面は、標準見積から作成した下書きを専用の画面へ渡す', () => {
    expect(manualDraftPage).toContain("detail.draft.source_kind === 'standard_estimate'");
    expect(manualDraftPage).toContain('redirect(`/admin/quotes/standard-drafts/${id}');
  });

  it('内部原価の表は、お客様向けの画面・PDF・API から参照しない', () => {
    const customerFacing = ['app/mypage', 'app/api', 'lib/pdf', 'app/(site)'].filter((dir) => fs.existsSync(path.join(root, dir)));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel);
      }
    };
    customerFacing.forEach(walk);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(read(file)).not.toMatch(/quote_internal_snapshots|quote_draft_item_costs|quote_draft_internals|get_standard_quote_draft/);
    }
  });
});
