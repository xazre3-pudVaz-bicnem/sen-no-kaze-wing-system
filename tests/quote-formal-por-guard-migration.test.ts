import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20261016111000_quote_formal_por_guard.sql');
const moneyMigration = read('supabase/migrations/20261013180000_quote_standard_estimate_money.sql');
const revisionMigration = read('supabase/migrations/20260928174500_quote_revision_staff_access_corrective.sql');
const formalizationMigration = read('supabase/migrations/20261005090000_legacy_accepted_formal_compat.sql');
const check = read('scripts/db-rehearsal/check.mjs');
const runtime = read('scripts/db-rehearsal/runtime-quote-formal-por-guard.sql');
const supabaseStore = read('lib/data/supabase-store.ts');
const localStore = read('lib/data/local-store.ts');
const store = read('lib/data/store.ts');
const adminActions = read('lib/actions/admin.ts');
const formalizationAction = read('lib/actions/legacy-accepted-formalization.ts');
const standardActions = read('lib/actions/standard-quotes.ts');
const standardEditor = read('components/admin/standard-quote-editor.tsx');
const authoringGrid = read('components/admin/quote-authoring-ui.tsx');
const dealerForms = read('components/admin/dealer-forms.tsx');
const editPage = read('app/admin/quotes/[id]/edit/page.tsx');
const formalizePage = read('app/admin/quotes/[id]/formalize/page.tsx');
const formalizationForm = read('components/admin/legacy-accepted-formalization-form.tsx');
const draftEditor = read('components/admin/quote-draft-editor.tsx');

/** migration の E'...' の連結を、関数の本文の文字列に戻す（目印が既存の定義にあることを確かめるため） */
function anchorText(index: number): string {
  const body = migration.slice(migration.indexOf('  v_from := array['), migration.indexOf('  v_to := array['));
  const parts = body.split(/\n    -- /).slice(1);
  const literal = parts[index].split('\n').slice(1).join('\n');
  return [...literal.matchAll(/E'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'").replace(/\\n/g, '\n')).join('');
}

describe('正式見積の発行で金額未確定の明細を残さない止め（20261016111000）', () => {
  it('適用の前に、前提の関数・列があり、まだ足していないこと・既存の明細が状態の印を使っていないことを確かめる', () => {
    expect(migration).toContain("to_regprocedure('public.create_quote_revision(uuid, jsonb, text)') is null");
    expect(migration).toContain("to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)') is null");
    expect(migration).toContain("column_name = 'price_mode'");
    expect(migration).toContain("to_regclass('public.quote_por_confirmations') is not null");
    expect(migration).toContain("to_regprocedure('public.quote_line_unresolved(text, numeric, uuid, text, text, boolean, boolean)') is not null");
    expect(migration).toContain("exists (select 1 from public.quote_items where remark like '［今回の契約対象外］%' or remark like '［0円確定］%')");
    expect(migration).toContain("exists (select 1 from public.quote_draft_items where remark like '［今回の契約対象外］%' or remark like '［0円確定］%')");
  });

  it('明細の表のトリガーで、状態の印のある行は 0 円・0円確定は理由あり・価格の決め方は「金額を入力」を保証する', () => {
    expect(migration).toContain('create trigger quote_items_line_state_guard\nbefore insert or update of remark, unit_price, amount, kind on public.quote_items');
    expect(migration).toContain(
      'create trigger quote_draft_items_line_state_guard\nbefore insert or update of remark, unit_price, amount, price_mode, kind on public.quote_draft_items'
    );
    expect(migration).toContain("v_price_mode text := v_row ->> 'price_mode';");
    // 標準見積・本体の内訳の明細の備考は見積の下書きへ写るので、印の書き出しを使わせない（適用前の確認でも止める）
    expect(migration).toContain('create trigger standard_estimate_revision_lines_marker_guard\nbefore insert or update of remark on public.standard_estimate_revision_lines');
    expect(migration).toContain('create trigger base_master_revision_lines_marker_guard\nbefore insert or update of remark on public.base_master_revision_lines');
    expect(migration).toContain("or exists (select 1 from public.base_master_revision_lines where remark like '［今回の契約対象外］%' or remark like '［0円確定］%')");
  });

  it('前の版との突き合わせ：発行する版は parent_quote_id の明細と、下書きは明細のキーも合わせて比べる', () => {
    expect(migration).toContain('select q.parent_quote_id into v_parent from public.quotes q where q.id = p_quote_id;');
    expect(migration).toContain('select d.parent_quote_id, d.standard_estimate_revision_id');
    expect(migration).toContain('on z.kind = c.kind and z.name_key = c.name_key and z.description_key = c.description_key');
    // 下書きの自動計算の行として外すのは経費の行だけ。標準見積から作った初回の下書きは元の標準見積の版と比べる
    expect(migration).toContain("left join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key");
    expect(migration).toContain('on z.match_key is not distinct from c.match_key and z.kind = c.kind and z.name_key = c.name_key and z.description_key = c.description_key');
  });

  it('止めを足す目印は、適用済みの定義（元の migration）にそのままある', () => {
    // finalize の 2 つは 20261013180000 が足した POR の確認の直後
    for (const index of [0, 1]) {
      const anchor = anchorText(index);
      expect(anchor).toContain('価格未確定（POR）の明細が残っています');
      const fragments = anchor.split('\n').filter((line) => line.trim().length > 0);
      for (const fragment of fragments) expect(moneyMigration).toContain(fragment.trim().replace(/'/g, "''"));
    }
    expect(revisionMigration).toContain(anchorText(2).trimEnd());
    expect(anchorText(3)).toBe('  return v_new;\n');
    expect(formalizationMigration).toContain('\n  return v_new;\nend;');
  });

  it('4 つの関数の定義を確かめてから 1 箇所ずつ足し、owner・SECURITY DEFINER・search_path・EXECUTE が変わらないことを検算する', () => {
    for (const signature of [
      'public.finalize_quote_draft(uuid, integer)',
      'public.finalize_quote_revision_draft(uuid, integer)',
      'public.create_quote_revision(uuid, jsonb, text)',
      'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)',
    ]) {
      expect(migration).toContain(`'${signature}'`);
    }
    expect(migration).toContain('differs from the reviewed definition (anchor is not unique)');
    expect(migration).toContain('is already patched');
    expect(migration).toContain('owner / security definer / search_path / EXECUTE changed');
    expect(migration).toContain('perform public.assert_quote_draft_lines_resolved(d.id);');
    expect(migration).toContain('perform public.assert_quote_lines_resolved(v_new);');
    expect(migration).toContain('perform public.assert_case_por_selections_confirmed(parent.id, v_uid);');
  });

  it('内部の部品は利用者から実行させず、画面用の 2 つの RPC だけをログインした利用者に開く', () => {
    for (const fn of [
      'quote_line_explicit_state(text)',
      'quote_line_por_marked(uuid, text, text)',
      'quote_line_unresolved(text, numeric, uuid, text, text, boolean, boolean)',
      'quote_line_state_guard()',
      'quote_line_marker_master_guard()',
      'configuration_por_selections(uuid)',
      'quote_por_selections_confirmed(uuid, uuid, jsonb)',
      'assert_quote_lines_resolved(uuid)',
      'assert_quote_draft_lines_resolved(uuid)',
      'assert_case_por_selections_confirmed(uuid, uuid)',
    ]) {
      expect(migration).toContain(`revoke execute on function public.${fn} from public, anon, authenticated, service_role;`);
    }
    expect(migration).toContain('grant execute on function public.get_quote_por_selections(uuid) to authenticated;');
    expect(migration).toContain('grant execute on function public.confirm_quote_por_selections(uuid, text[]) to authenticated;');
    expect(migration).toMatch(/revoke all privileges on table public\.quote_por_confirmations from public, anon, authenticated;/);
    expect(migration).toContain('alter table public.quote_por_confirmations enable row level security;');
    expect(migration).toContain('before update or delete on public.quote_por_confirmations');
  });

  it('確認は担当者ごと・版ごとで、画面に出した一覧と今の一覧が違えば記録しない', () => {
    expect(migration).toContain('and c.confirmed_by = p_user_id');
    expect(migration).toContain("if v_current_quote_id is distinct from q.id or q.status not in ('issued', 'accepted') then");
    expect(migration).toContain('if v_keys is distinct from v_given then');
    // 確認と発行は同じ順で lock する（見積の行が先）
    expect(migration).toContain('select * into q from public.quotes where id = p_quote_id for update;');
  });

  it('実 DB の検査を check.mjs に登録している', () => {
    expect(check).toContain("import { runtimeQuoteFormalPorGuard } from './runtime-quote-formal-por-guard.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeQuoteFormalPorGuard(client));');
    expect(runtime).toMatch(/^rollback;$/m);
    expect((runtime.match(/'QPG-\d+ /g) ?? []).length).toBeGreaterThanOrEqual(50);
  });
});

describe('画面・データ層のつなぎ', () => {
  it('DataStore に足した処理は Supabase とローカルの両方にある', () => {
    expect(store).toContain('getQuotePorSelections(quoteId: string, actor: SessionUser): Promise<QuotePorSelectionState>;');
    expect(store).toContain('por_confirmation_keys?: string[] | null;');
    expect(supabaseStore).toContain("db.rpc('get_quote_por_selections', { p_quote_id: quoteId })");
    expect(supabaseStore).toContain("db.rpc('confirm_quote_por_selections', {");
    expect(supabaseStore).toContain("isMissingNamedFunction(error, 'get_quote_por_selections')");
    expect(localStore).toContain('async getQuotePorSelections(quoteId: string, actor: SessionUser)');
    expect(localStore).toContain('this.recordQuotePorConfirmation(id, input.por_confirmation_keys, actor);');
    expect(localStore).toContain('unresolvedLinesError(unresolved.map((it) => it.name))');
    expect(localStore).toContain('const unresolvedLines = findUnresolvedLines(newItems, {');
    expect(localStore).toContain('const guardError = quoteLineStateGuardError(it);');
    expect(localStore).toContain('unconfirmedPorSelectionsError(porSelections)');
  });

  it('改訂の画面は一覧を DB から読み、確認欄と未確定の行を示し、理由が残る間は発行のボタンを押せない', () => {
    expect(editPage).toContain('store.getQuotePorSelections(quote.id, actor).catch(() => ({ ...EMPTY_POR_SELECTION_STATE, loadError: true })),');
    expect(editPage).toContain('porState={porState}');
    expect(dealerForms).toContain('<QuotePorReview');
    expect(dealerForms).toContain('<SubmitButton pending={pending} disabled={porBlockers.length > 0} label={');
    expect(dealerForms).toContain("const porSelections = porState.available ? porState.selections : [];");
    // 金額は計算しない（発行の金額は DB が決める）。確認の有無は Server Action で読む
    expect(adminActions).toContain("const porConfirmed = formData.get('por_confirmed') === '1';");
    expect(adminActions).toContain('por_confirmation_keys: porConfirmed ? porKeys : null');
  });

  it('承諾済みの概算から確定見積を作る画面も、確認を記録してから発行する（施工以外の未確定の行は直せないと示す）', () => {
    expect(formalizePage).toContain('store.getQuotePorSelections(quote.id, actor).catch(() => ({ ...EMPTY_POR_SELECTION_STATE, loadError: true })),');
    expect(formalizePage).toContain('carriedItems={carriedItems}');
    expect(formalizationForm).toContain('disabled={pending || porBlockers.length > 0}');
    expect(formalizationForm).toContain('この画面では施工の金額だけを入れられるため、この明細は直せません');
    expect(formalizationAction).toContain("db.rpc('confirm_quote_por_selections', {");
    expect(formalizationAction.indexOf("db.rpc('confirm_quote_por_selections'")).toBeLessThan(
      formalizationAction.indexOf("db.rpc('create_formal_quote_from_accepted_preliminary'")
    );
  });

  it('Web 以外の下書きでも、未確定の行が残る間は正式見積を発行できない', () => {
    expect(draftEditor).toContain('unresolvedNames.length > 0');
    expect(draftEditor).toContain('data-testid="draft-por-blockers"');
    expect(draftEditor).toContain('matchLineKey: true');
  });

  it('「対象外」「0円確定」は画面の明示の選択で、Server Action が備考の印にする（手入力の印は受け付けない）', () => {
    // 改訂・手入力の下書き（新規・保存）
    expect(adminActions.match(/applyQuoteLineStates\(parsed\.data\.items\)/g)).toHaveLength(3);
    expect(adminActions).toContain('if (e instanceof QuoteLineStateInputError) return { ok: false, error: e.message };');
    // 旧形式の確定見積・標準見積から作る下書き
    expect(formalizationAction).toContain('installationItems = applyQuoteLineStates(parsed.data.items);');
    expect(formalizationAction).toContain('p_installation_items: installationItems,');
    expect(standardActions).toContain("cost_unit_price: line.price_mode === 'por' ? null : line_state === 'excluded' ? 0 : line.cost_unit_price,");
    expect(standardActions).toContain("if (line_state && (line.section_code === 'base' || line.price_mode !== 'manual')) {");
    // 画面：扱いの列・確認の欄・送信の値
    expect(authoringGrid).toContain('data-testid="quote-line-state"');
    expect(dealerForms).toContain('name={`items.${index}.line_state`}');
    expect(dealerForms).toContain('showLineState');
    expect(standardEditor).toContain("(['zero_confirmed', 'excluded'] as const)");
    expect(formalizationForm).toContain('data-testid="formalization-line-state"');
  });
});
