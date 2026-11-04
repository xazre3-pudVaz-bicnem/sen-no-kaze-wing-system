import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20261016112000_product_sales_stop_discontinue.sql');
const lifecycleMigration = read('supabase/migrations/20261015113000_product_lifecycle_guards.sql');
const moneyMigration = read('supabase/migrations/20261013180000_quote_standard_estimate_money.sql');
const check = read('scripts/db-rehearsal/check.mjs');
const runtime = read('scripts/db-rehearsal/runtime-product-sales-stop.sql');
const store = read('lib/data/store.ts');
const supabaseStore = read('lib/data/supabase-store.ts');
const localStore = read('lib/data/local-store.ts');
const requestPage = read('app/(site)/mypage/configurations/[id]/request-quote/page.tsx');
const simulator = read('components/simulator/simulator-app.tsx');
const ledgerPage = read('app/admin/ledger/page.tsx');

/** options_lifecycle_guard の新しい定義（migration の中の本文） */
const guard = migration.slice(migration.indexOf('create or replace function public.options_lifecycle_guard()'), migration.indexOf('drop trigger options_lifecycle_guard on public.options;'));

describe('販売停止・廃番（20261016112000）', () => {
  it('適用の前に、#500 の部品があり、まだ廃番の列が無いことを確かめる', () => {
    expect(migration).toContain("to_regprocedure('public.options_lifecycle_guard()') is null");
    expect(migration).toContain("to_regprocedure('public.product_lifecycle_baseline_option_ids(uuid, text)') is null");
    expect(migration).toContain("column_name = 'discontinued_at'");
  });

  it('廃番の印は販売停止の商品だけに付く（制約）', () => {
    expect(migration).toContain('add column discontinued_at timestamptz,');
    expect(migration).toContain('add constraint options_discontinued_requires_stopped check (discontinued_at is null or archived_at is not null);');
  });

  it('販売停止は、公開中の標準見積・Excel 標準見積・本体の仕様で使っていても止めない。必須・初期選択・前提商品は今のまま止める', () => {
    expect(lifecycleMigration).toContain('公開中の標準見積の標準状態で使われているため、取扱終了にできません');
    expect(guard).not.toContain('standard_estimate_revision_baseline_items');
    expect(guard).not.toContain('estimate_templates');
    expect(guard).not.toContain('bm.presets');
    expect(guard).toContain('if new.is_required or new.is_default then');
    expect(guard).toContain('from public.option_dependencies d');
  });

  it('廃番の商品は再開できず、廃番・取り消しは理由が必要。取り消しは本部の管理者だけで、販売停止に戻る', () => {
    expect(guard).toContain("current_setting('wing.option_lifecycle_reason', true)");
    expect(guard).toContain('廃番にできるのは販売停止の商品だけです');
    expect(guard).toContain('if not public.is_admin() then');
    expect(guard).toContain('廃番の商品は販売を再開できません');
    expect(guard).toContain('廃番を取り消しても販売は再開しません（販売停止に戻ります）');
    expect(migration).toContain('before update of archived_at, simulator_visible, discontinued_at on public.options');
  });

  it('廃番の RPC は商品台帳の編集権限を確かめ、取り消しは本部の管理者だけ。画面が読んだ版でなければ LOCKED', () => {
    expect(migration).toContain("if not public.can_edit_catalog() or (not coalesce(p_discontinued, false) and not public.is_admin()) then");
    expect(migration).toContain("perform set_config('wing.option_lifecycle_reason', v_reason, true);");
    expect(migration).toContain('and updated_at = p_expected_updated_at');
    expect(migration).toContain('grant execute on function public.set_option_discontinued(uuid, timestamptz, boolean, text) to authenticated;');
    expect(migration).toContain('revoke execute on function public.set_option_discontinued(uuid, timestamptz, boolean, text) from public, anon, service_role;');
  });

  it('販売停止・再開・廃番・取り消し・シミュレーター表示を変更履歴に残す（廃番・取り消しは理由も）', () => {
    expect(migration).toContain('create or replace function public.trg_audit_option()');
    expect(migration).toContain("'販売を停止：'");
    expect(migration).toContain("'廃番にした：'");
    expect(migration).toContain("coalesce('（理由：' || v_reason || '）', '')");
  });

  it('①：標準構成に販売停止・廃番の商品がある仕様は、新しい見積依頼・標準見積からの新しい見積・正式発行を止める', () => {
    expect(migration).toContain('create trigger quote_requests_baseline_lifecycle_guard\nbefore insert on public.quote_requests');
    expect(migration).toContain('create trigger quote_drafts_standard_estimate_lifecycle_guard\nbefore insert or update of standard_estimate_revision_id on public.quote_drafts');
    expect(migration).toContain('perform public.assert_standard_estimate_source_sellable(d.id);');
    // 受付の判定はログインした利用者だけ（anon から実行できる SECURITY DEFINER は RLS の判定関数だけ）
    expect(migration).toContain('revoke execute on function public.get_spec_acceptance_state(uuid, text) from public, anon, service_role;');
    expect(migration).toContain('grant execute on function public.get_spec_acceptance_state(uuid, text) to authenticated;');
  });

  it('正式保存の 2 つの関数に足す目印は、適用済みの定義（20261013180000 の追加分）にある', () => {
    const anchor = "  if d.source_kind = ''standard_estimate'' and v_rank < 3 then";
    expect(migration).toContain(`E'${anchor}\\n'`);
    expect(moneyMigration).toContain(`E'${anchor}\\n'`);
    expect(moneyMigration).toContain("E'    raise exception ''FORBIDDEN: 標準見積から作成した見積は、現在は本部管理者だけが発行できます'' using errcode = ''42501'';\\n'");
  });

  it('#500 の止めの文言は、元の定義にある文言だけを「販売停止中」に置き換える（判定は変えない）', () => {
    const body = migration.slice(migration.indexOf('v_from constant text[] := array['), migration.indexOf('v_to constant text[] := array['));
    const fromMessages = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    expect(fromMessages).toHaveLength(9);
    for (const message of fromMessages) {
      expect(message).toContain('取扱終了');
      expect(lifecycleMigration).toContain(message);
    }
    const toBody = migration.slice(migration.indexOf('v_to constant text[] := array['), migration.indexOf('$patch_messages$;'));
    const toMessages = [...toBody.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).slice(0, 9);
    expect(toMessages.every((message) => message.includes('販売停止中') && !message.includes('取扱終了'))).toBe(true);
  });

  it('実 DB の検査を check.mjs に登録している', () => {
    expect(check).toContain("import { runtimeProductSalesStop } from './runtime-product-sales-stop.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeProductSalesStop(client));');
    expect(runtime).toMatch(/^rollback;$/m);
    expect((runtime.match(/'PSS-\d+ /g) ?? []).length).toBeGreaterThanOrEqual(26);
  });
});

describe('画面・データ層のつなぎ（販売停止・廃番）', () => {
  it('DataStore に足した処理は Supabase とローカルの両方にある', () => {
    expect(store).toContain('setProductDiscontinued(');
    expect(store).toContain('getSpecAcceptanceState(modelId: string, specCode: string | null): Promise<SpecAcceptanceState>;');
    expect(supabaseStore).toContain("db.rpc('set_option_discontinued', {");
    expect(supabaseStore).toContain("db.rpc('get_spec_acceptance_state', { p_model_id: modelId, p_spec_code: specCode })");
    expect(supabaseStore).toContain("isMissingNamedFunction(error, 'get_spec_acceptance_state')");
    expect(localStore).toContain('async setProductDiscontinued(');
    expect(localStore).toContain('async getSpecAcceptanceState(modelId: string, specCode: string | null)');
    expect(localStore).toContain('この仕様の標準の商品構成に、販売停止の商品');
  });

  it('見積依頼の画面は受付の判定を DB に聞き、受け付けない間は依頼の入力を出さない', () => {
    expect(requestPage).toContain('const acceptance = await store.getSpecAcceptanceState(configuration.base_model_id, configuration.spec_code ?? null);');
    expect(requestPage).toContain('{!acceptance.accepting && (');
    expect(requestPage).toContain('{acceptance.accepting && (');
  });

  it('シミュレーターは、その仕様の標準構成に販売停止の商品があれば受付停止を案内する（ログイン前も）', () => {
    expect(simulator).toContain('estimateSpecStoppedProductNames(ctx, model, specCode, [');
    expect(simulator).toContain('...(estimateTemplateByCode.get(specCode)?.baseline_option_ids ?? []),');
    // v2.5 の売価を使う間は、公開中の版の選択枠の商品も標準構成として見る（v2.5 PR-C1。DB の get_spec_acceptance_state と同じ）
    expect(simulator).toContain('...((v25Pricing && v25SlotOptionIds(activeSaleView)) || []),');
    expect(simulator).toContain('data-testid="spec-acceptance-stopped"');
  });

  it('商品台帳は、廃番の操作を DB の更新の後だけ出し、取り消しは本部の管理者だけに出す', () => {
    expect(ledgerPage).toContain('const discontinueEnabled = lifecycleEnabled && Boolean(lifecycleCapability.discontinue);');
    expect(ledgerPage).toContain("canRestoreDiscontinued={actor.role === 'admin'}");
  });
});
