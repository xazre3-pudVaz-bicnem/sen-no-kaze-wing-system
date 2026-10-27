import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: vi.fn(() => true) }));

import { costImportChoiceState, costImportProductState } from '@/lib/data/option-cost-import';
import { canEditCostField, costRecordingNotice } from '@/lib/data/option-cost-recording';
import { seedOptions } from '@/lib/seed/catalog';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20261027100000_v25_initial_cost_import.sql');
const sqlOnly = migration.replace(/--[^\n]*/g, '');

describe('v2.5 PR-A3：既存の商品価格・追加金額の初期の原価 Version への取り込み', () => {
  it('取り込みの関数は本部だけ・確かめた金額つき。データは migration では変えない', () => {
    expect(sqlOnly).toContain('create function public.import_option_standard_costs(p_items jsonb, p_change_reason text)');
    expect(sqlOnly).toContain('security definer');
    expect(sqlOnly).toContain("set search_path = ''");
    expect(sqlOnly).toContain('if not public.can_manage_option_hq_standard_cost() then');
    expect(sqlOnly).toContain('revoke all on function public.import_option_standard_costs(jsonb, text) from public, anon, authenticated, service_role;');
    expect(sqlOnly).toContain('grant execute on function public.import_option_standard_costs(jsonb, text) to authenticated;');
    // 既存の原価の RPC で Version を作る（作り方・監査は 20261016200000 のまま）
    expect(sqlOnly).toContain('perform 1 from public.set_option_hq_standard_cost(v_id, v_amount, coalesce(v_copy_lock, 0), v_reason);');
    expect(sqlOnly).toContain('perform 1 from public.set_option_variant_cost_adjustment(v_id, v_amount, v_current_id, v_reason);');
    // migration の中で行を足したり変えたりしない（関数を作るだけ）
    expect(sqlOnly).not.toMatch(/^\s*(insert into|update|delete from)\s+public\.(options|option_variant_choices|option_standard_cost_versions|option_variant_cost_versions|option_hq_standard_costs)\b/m);
    expect(sqlOnly).not.toMatch(/\bselect\s+public\.import_option_standard_costs\(/);
  });

  it('対象と除外：登録済みだけ・別途見積と 0 円の商品は止める・確かめた後に金額が変わったら止める・同じ金額は何もしない', () => {
    expect(sqlOnly).toContain("if v_option.status <> 'published' then");
    expect(sqlOnly).toContain('if v_option.price_on_request then');
    expect(sqlOnly).toContain('if v_amount <= 0 then');
    expect(sqlOnly).toContain('if v_option.price is distinct from v_amount then');
    expect(sqlOnly).toContain('if v_choice.extra_price is distinct from v_amount then');
    expect(sqlOnly).toContain("result := 'unchanged'");
    expect(sqlOnly).toContain("message = pg_catalog.format('CONFLICT:");
    // 商品の行を id 順に先に lock（原価の RPC・商品の削除と同じ順）
    expect(sqlOnly).toContain('perform 1 from public.options o where o.id = any(v_option_ids) order by o.id for update;');
    // 取り込んだ後に原価が 0 円未満になる組み合わせは、商品名つきで先に止める
    expect(sqlOnly).toContain('s.product_cost + s.min_total < 0');
  });

  it('画面の一覧の状態：別途見積・0 円は取り込まない、8 月の仮商品と取扱終了は初期値で選ばない', () => {
    const seedId = seedOptions[0].id;
    const realId = '00000000-0000-4000-8000-0000000a3001';
    expect(costImportProductState({ id: realId, priceOnRequest: true, amount: 1000, currentAmount: null, archived: false })).toBe('por');
    expect(costImportProductState({ id: realId, priceOnRequest: false, amount: 0, currentAmount: null, archived: false })).toBe('zero');
    expect(costImportProductState({ id: realId, priceOnRequest: false, amount: null, currentAmount: null, archived: false })).toBe('zero');
    expect(costImportProductState({ id: realId, priceOnRequest: false, amount: 5000, currentAmount: 5000, archived: false })).toBe('same');
    expect(costImportProductState({ id: seedId, priceOnRequest: false, amount: 5000, currentAmount: null, archived: false })).toBe('seed');
    expect(costImportProductState({ id: realId, priceOnRequest: false, amount: 5000, currentAmount: null, archived: true })).toBe('archived');
    expect(costImportProductState({ id: realId, priceOnRequest: false, amount: 5000, currentAmount: 4000, archived: false })).toBe('import');
    // 選択肢は 0 円も「標準と同じ（差額 0 円）」として取り込む。別途見積は取り込まない
    expect(costImportChoiceState({ priceOnRequest: false, amount: 0, currentAmount: null })).toBe('import');
    expect(costImportChoiceState({ priceOnRequest: false, amount: 0, currentAmount: 0 })).toBe('same');
    expect(costImportChoiceState({ priceOnRequest: true, amount: 0, currentAmount: null })).toBe('por');
  });

  it('原価の欄：仕組みが無い間（ローカル・未適用）は従来どおり、ある間は本部だけ。記録に失敗したら保存の後に案内する', () => {
    expect(canEditCostField({ available: false, canManage: false })).toBe(true);
    expect(canEditCostField({ available: true, canManage: true })).toBe(true);
    expect(canEditCostField({ available: true, canManage: false })).toBe(false);
    expect(costRecordingNotice({ status: 'recorded' })).toBeNull();
    expect(costRecordingNotice({ status: 'error', message: '適用後の標準原価が0円未満になる組み合わせがあります' })).toContain('「原価 Version の取り込み」');
  });

  it('取り込みの Server Action は本部だけ・ローカルでは止める・一覧の形式を確かめてから DB に渡す', () => {
    const action = read('lib/actions/option-cost-import.ts');
    expect(action).toContain("await requireAdmin(PAGE);");
    expect(action).toContain("if (isLocalMode()) redirect(errorPath('ローカル検証モードでは取り込めません。'));");
    expect(action).toContain("db.rpc('import_option_standard_costs', { p_items: items, p_change_reason: reason })");
    expect(action).toMatch(/const ITEM_PATTERN = \/\^\(option\|choice\)/);
    const page = read('app/admin/options/cost-import/page.tsx');
    expect(page).toContain("await requireAdmin('/admin/options/cost-import');");
    expect(page).toContain('value={`option:${product.id}:${product.amount}`}');
    expect(page).toContain("defaultChecked={product.state === 'import'}");
    expect(read('app/admin/ledger/page.tsx')).toContain('costAccess.available && costAccess.canManage && <Link href="/admin/options/cost-import"');
  });
});

describe('v2.5 PR-A3：商品登録 STEP1 の商品標準原価・原価差額', () => {
  const forms = read('components/admin/forms.tsx');
  const variants = read('components/admin/option-variant-manager.tsx');
  const registered = read('components/admin/registered-option-edit-flow.tsx');
  const actions = read('lib/actions/admin.ts');

  it('⑥ 商品価格 → 商品標準原価（税別）、⑤ 追加金額 → 原価差額（税別）。フリー商品は従来どおり', () => {
    expect(forms).toContain("label={isFreeProduct ? '商品価格（税別・円）' : '商品標準原価（税別・円）'}");
    expect(forms).toContain('千の風が商品を調達する想定の購入金額（税別）です。売価は標準見積の販売費率・掛率・経費のルールで計算します。');
    expect(variants).toContain('label="原価差額（税別・円）"');
    expect(variants).toContain('標準仕様からの調達想定の原価の差額です。標準と同じなら0円です。');
    expect(registered).toContain("label={isFreeProduct ? '商品価格（税別・円）' : '商品標準原価（税別・円）'}");
  });

  it('原価の欄は本部だけ（仕組みがある間）。出さない担当者には金額を渡さず、保存は今の金額を保つ', () => {
    expect(forms).toContain('const showCostFields = isFreeProduct || canEditCost;');
    expect(forms).toContain('<input type="hidden" name="price" value={showCostFields ? option.price : 0} />');
    expect(forms).toContain('data-testid="option-cost-hidden-note"');
    expect(variants).toContain('{canEditCost && (');
    expect(registered).toContain('price: showCostFields ? numberOrNull(data.get(\'price\')) ?? 0 : option.price,');
    expect(actions).toContain("price: keepExistingPrice ? String(existingOption?.price ?? 0) : formData.get('price'),");
    expect(actions).toContain("extra_price: keepExistingPrice ? existing?.extra_price ?? 0 : formData.get('extra_price') || 0,");
  });

  it('登録済みの商品だけ、本部の保存・登録で原価の Version を作る（下書きは登録のときに作る）', () => {
    expect(actions).toContain("if (o.status === 'published' && costAccess.available && costAccess.canManage) {");
    expect(actions).toContain("costNotice = costRecordingNotice(await recordPublishedOptionCost(o.id, 'save'));");
    expect(actions).toContain("const costResult = await recordPublishedOptionCost(optionId, 'publish');");
    expect(actions).toContain("await recordPublishedChoiceCosts(optionId, 'publishChoice')");
    const recording = read('lib/data/option-cost-recording.ts');
    expect(recording).toContain("if (!option || option.status !== 'published' || option.price_on_request) return { status: 'skipped' };");
    // 下書きの 0 円は価格未確認。登録のときの確認済みの 0 円だけ記録する
    expect(recording).toContain("if (price < 0 || (price === 0 && kind !== 'publish')) return { status: 'skipped' };");
    // 原価の本部商品基準原価カードは入力欄を持たない（二重入力しない）
    expect(read('components/admin/option-hq-standard-cost-card.tsx')).not.toContain('<form');
  });
});
