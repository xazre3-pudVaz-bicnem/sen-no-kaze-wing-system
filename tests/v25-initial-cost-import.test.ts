import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: vi.fn(() => true) }));

import { costImportChoiceState, costImportProductState } from '@/lib/data/option-cost-import';
import { canEditCostField, costRecordingNotice } from '@/lib/data/option-cost-recording';
import { withoutChoiceCost, withoutOptionCost } from '@/lib/domain/option-cost-access';

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

  it('画面の一覧の状態：別途見積・0 円は取り込まない、メーカー・型番なし（8 月の仮商品を含む）と取扱終了は初期値で選ばない', () => {
    const maker = { manufacturer: 'メーカー', modelNo: 'AB-123' };
    expect(costImportProductState({ ...maker, priceOnRequest: true, amount: 1000, currentAmount: null, archived: false })).toBe('por');
    expect(costImportProductState({ ...maker, priceOnRequest: false, amount: 0, currentAmount: null, archived: false })).toBe('zero');
    expect(costImportProductState({ ...maker, priceOnRequest: false, amount: null, currentAmount: null, archived: false })).toBe('zero');
    expect(costImportProductState({ ...maker, priceOnRequest: false, amount: 5000, currentAmount: 5000, archived: false })).toBe('same');
    // 2026-10-13 の先方の決まり：メーカー・型番が入っていて商品が確定しているものだけ原価として扱う
    expect(costImportProductState({ manufacturer: null, modelNo: null, priceOnRequest: false, amount: 5000, currentAmount: null, archived: false })).toBe('no_model');
    expect(costImportProductState({ manufacturer: 'メーカー', modelNo: '  ', priceOnRequest: false, amount: 5000, currentAmount: null, archived: false })).toBe('no_model');
    expect(costImportProductState({ ...maker, priceOnRequest: false, amount: 5000, currentAmount: null, archived: true })).toBe('archived');
    expect(costImportProductState({ ...maker, priceOnRequest: false, amount: 5000, currentAmount: 4000, archived: false })).toBe('import');
    // 初期投入専用のシード（lib/seed/catalog.ts）を本番の判定に使わない（CLAUDE.md）
    expect(read('lib/data/option-cost-import.ts')).not.toContain('lib/seed/catalog');
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

describe('v2.5 PR-A3：独立レビューの指摘への対応', () => {
  it('権限の確認に失敗したら、原価の欄は隠し、保存は止める（本部の入力を本部以外の保存として捨てない）', () => {
    expect(canEditCostField({ available: true, canManage: false, error: true })).toBe(false);
    const recording = read('lib/data/option-cost-recording.ts');
    expect(recording).toContain('if (manage.error) return { available: true, canManage: false, error: true };');
    const actions = read('lib/actions/admin.ts');
    expect(actions.split('if (costAccess.error) return { ok: false, error: COST_ACCESS_ERROR_MESSAGE };').length - 1).toBeGreaterThanOrEqual(4);
    expect(actions).toContain('if (costAccess.error) redirect(previewUrl({ error: COST_ACCESS_ERROR_MESSAGE }));');
    expect(read('lib/actions/product-registration-variants.ts')).toContain('if (costAccess.error) return { ok: false, error: COST_ACCESS_ERROR_MESSAGE };');
  });

  it('原価を出さない担当者へ渡すデータからも金額を外す（台帳・商品画面・新しい商品の画面・お客様表示の確認）', () => {
    expect(withoutOptionCost({ price: 120000, list_price: 98000 })).toEqual({ price: 0, list_price: 98000 });
    expect(withoutChoiceCost({ extra_price: 8000, name: '大' })).toEqual({ extra_price: 0, name: '大' });
    const ledger = read('app/admin/ledger/page.tsx');
    expect(ledger).toContain('options={showCost ? catalogOptions : catalogOptions.map(withoutOptionCost)}');
    expect(ledger).toContain('choices: variants.choices.map(withoutChoiceCost)');
    const optionPage = read('app/admin/options/[id]/page.tsx');
    expect(optionPage).toContain('const canEditCost = canEditProductCost(costAccess, category?.code);');
    expect(optionPage).toContain('const clientOption = canEditCost ? option : withoutOptionCost(option);');
    expect(optionPage).toContain('const clientOptions = withoutHqOptionCosts(options, costAccess, new Map(categories.map((row) => [row.id, row.code])));');
    expect(optionPage).toContain('option={clientOption}');
    expect(optionPage).toContain('allOptions={clientOptions}');
    expect(optionPage).toContain('choices={clientChoices}');
    expect(optionPage).toContain('showPrice={canEditCost}');
    expect(read('app/admin/options/new/page.tsx')).toContain('allOptions={withoutHqOptionCosts(options, costAccess, new Map(allCategories.map((category) => [category.id, category.code])))}');
    // 商品一覧（本部商品だけが並ぶ）も、本部以外には商品標準原価の列を出さない
    const list = read('app/admin/options/page.tsx');
    expect(list).toContain('const showCost = canEditCostField(costAccess);');
    expect(list).toContain('{showCost && <Th right>商品標準原価（税別）</Th>}');
    expect(read('components/admin/option-customer-preview.tsx')).toContain("? '本部が登録します'");
  });

  it('本部以外は、本部商品を原価 0 円（未登録）のまま登録（公開）しない。本部商品の商品標準原価の一括更新は本部だけ', () => {
    const actions = read('lib/actions/admin.ts');
    expect(actions).toContain("redirect(previewUrl({ error: '本部商品の商品標準原価が未登録です。本部が原価を登録してから登録（公開）します。' }));");
    expect(actions).toContain("return { ok: false, error: '本部商品の商品標準原価の一括更新は、本部だけが行えます。' };");
    // 一括更新の記録は、1 件目が失敗しても残りを続ける（??= で後続の呼び出しを飛ばさない）
    expect(actions).not.toContain('costNotice ??=');
    // 判定は商品ごと（本部商品の外＝旧フリー商品には掛けない）
    expect(read('lib/data/option-cost-recording.ts')).toContain('return isHqCostProduct(categoryCode) ? access : NO_COST_RECORDING;');
    expect(actions).toContain('? await getCostAccessForProduct(() => store.listCategories(), option.category_id)');
    // 「選択項目を追加」のダイアログも同じ判定を使う（判定は 1 か所）
    expect(read('lib/actions/product-registration-variants.ts')).toContain('await getCostAccessForProduct(() => store.listCategories(), option.category_id);');
  });

  it('商品の一括登録（Excel）は本部以外も続けて使える。本部商品の金額だけ反映しない（2026-10-29 先方の回答）', () => {
    const actions = read('lib/actions/admin.ts');
    expect(actions).not.toContain('商品標準原価を含む一括登録は、本部だけが行えます。');
    expect(actions).toContain('const protectHqCost = !canEditCostField(costAccess);');
    expect(actions).toContain('applyImportPlan(plan, images, { catalogImportUserId: actor.id, protectHqCost })');
    const apply = read('lib/import/apply.ts');
    expect(apply).toContain("const protectCost = options.protectHqCost === true && isHqCostProduct(category.code);");
    // 既存の本部商品は今の金額のまま、新しい本部商品は金額未登録（0 円）の下書き
    expect(apply).toContain('? { price: existing.price, price_on_request: existing.price_on_request }');
    expect(apply).toContain(': { price: 0, price_on_request: false }');
    // 選択肢も今の金額を引き継ぐ（新しい追加の選択肢は原価差額が未登録＝別途見積）
    expect(apply).toContain('? { extra_price: keptChoice.extra_price, price_on_request: keptChoice.price_on_request }');
    expect(apply).toContain(': newChoicePriceWithoutCost(c.kind)');
    // 本部の一括登録は、登録済みの本部商品の金額を原価の Version に記録する（選択肢は Excel にあったものだけ）
    expect(actions).toContain('for (const optionId of importedHq.hqOptionIds) {');
    expect(actions).toContain("await recordPublishedChoiceCosts(optionId, 'choice', choiceIds, costAccess)");
  });

  it('「選択項目を追加」のダイアログも同じ決まり（本部以外の追加は 0 円・本部の追加は登録済みなら Version を記録）', () => {
    const action = read('lib/actions/product-registration-variants.ts');
    expect(action).toContain('canEditCost ? parseChoiceExtraPrice(formData, index) : 0');
    expect(action).toContain("recordPublishedChoiceCosts(option.id, 'choice', savedChoiceIds, costAccess)");
    const dialog = read('components/admin/product-registration-final-refinements.tsx');
    expect(dialog).toContain("setCanEditCost(target.closest<HTMLElement>('#customer-selection')?.dataset.canEditCost !== 'false');");
    expect(dialog).toContain('{canEditCost && (');
    expect(read('components/admin/option-variant-manager.tsx')).toContain("data-can-edit-cost={canEditCost ? 'true' : 'false'}");
  });

  it('登録の後の戻り先でも、原価の記録の失敗を知らせる（共通の通知）', () => {
    expect(read('components/admin/ui.tsx')).toContain('{sp.cost_warning && <Alert tone="warn">{sp.cost_warning}</Alert>}');
  });

  it('取り込みは、途中の状態でも原価が 0 円未満にならない順に記録する（選択肢の上げ → 商品 → 選択肢の下げ）', () => {
    expect(sqlOnly).toContain("when (e ->> 'amount')::integer >= coalesce(cur.cost_adjustment, 0) then 1");
    expect(sqlOnly).toContain("when e ->> 'kind' = 'option' then 2");
    expect(sqlOnly).toContain("order by 2, (e ->> 'id')::uuid");
    // 一覧は件数の上限で黙って切れないよう、ページに分けて読む
    expect(read('lib/data/option-cost-import.ts')).toContain('.range(from, to)');
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
    // 書き戻す金額は今の DB の値（v2.5 PR-C1b。スイッチの後は本部以外の読み取りで本部商品の金額が 0 になるため）
    expect(actions).toContain("price: keepExistingPrice ? String(keptPrice) : formData.get('price'),");
    expect(actions).toContain("extra_price: keepExistingPrice ? keptChoicePrice.extra_price : formData.get('extra_price') || 0,");
    expect(actions).toContain("price_on_request: keepExistingPrice ? keptChoicePrice.price_on_request : formData.get('price_on_request'),");
  });

  it('登録済みの商品だけ、本部の保存・登録で原価の Version を作る（下書きは登録のときに作る）', () => {
    expect(actions).toContain("if (o.status === 'published' && costAccess.available && costAccess.canManage) {");
    expect(actions).toContain("costNotice = costRecordingNotice(await recordPublishedOptionCost(o.id, 'save', costAccess));");
    expect(actions).toContain("const costResult = await recordPublishedOptionCost(optionId, 'publish', costAccess);");
    expect(actions).toContain("await recordPublishedChoiceCosts(optionId, 'publishChoice', undefined, costAccess)");
    const recording = read('lib/data/option-cost-recording.ts');
    expect(recording).toContain("if (!optionRow || optionRow.status !== 'published' || optionRow.price_on_request) return { status: 'skipped' };");
    // 商品価格は利用者のロールから読めない（v2.5 PR-C1b）。本部と確かめた後にサーバーで読む
    expect(recording).toContain("const [option] = await withLegacyOptionPrices([optionRow as { id: string; status: string; price_on_request: boolean }], 'all');");
    // 下書きの 0 円は価格未確認。登録のときの確認済みの 0 円だけ記録する
    expect(recording).toContain("if (price < 0 || (price === 0 && kind !== 'publish')) return { status: 'skipped' };");
    // 原価の本部商品基準原価カードは入力欄を持たない（二重入力しない）
    expect(read('components/admin/option-hq-standard-cost-card.tsx')).not.toContain('<form');
  });
});
