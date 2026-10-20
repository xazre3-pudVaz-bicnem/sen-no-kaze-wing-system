import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase/migrations/20261020100000_quote_formal_por_guard.sql');
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

describe('正式見積の発行で未解決の別途見積（POR）を残さない止め（20261020100000）', () => {
  it('適用の前に、前提の関数・列があり、まだ足していないことを確かめる', () => {
    expect(migration).toContain("to_regprocedure('public.create_quote_revision(uuid, jsonb, text)') is null");
    expect(migration).toContain("to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)') is null");
    expect(migration).toContain("column_name = 'price_mode'");
    expect(migration).toContain("to_regclass('public.quote_por_confirmations') is not null");
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
    expect(migration).toContain("perform public.assert_quote_draft_lines_por_resolved(d.id);");
    expect(migration).toContain('perform public.assert_quote_lines_por_resolved(v_new);');
    expect(migration).toContain('perform public.assert_case_por_selections_confirmed(parent.id, v_uid);');
  });

  it('内部の部品は利用者から実行させず、画面用の 2 つの RPC だけをログインした利用者に開く', () => {
    for (const fn of [
      'quote_line_is_unresolved_por(numeric, uuid, text, text)',
      'configuration_por_selections(uuid)',
      'quote_por_selections_confirmed(uuid, uuid, jsonb)',
      'assert_quote_lines_por_resolved(uuid)',
      'assert_quote_draft_lines_por_resolved(uuid)',
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
    expect((runtime.match(/'QPG-\d+ /g) ?? []).length).toBeGreaterThanOrEqual(37);
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
    expect(localStore).toContain('unresolvedPorLinesError(unresolved.map((it) => it.name))');
    expect(localStore).toContain('unconfirmedPorSelectionsError(porSelections)');
  });

  it('改訂の画面は一覧を DB から読み、確認欄と未確定の行を示し、理由が残る間は発行のボタンを押せない', () => {
    expect(editPage).toContain('store.getQuotePorSelections(quote.id, actor),');
    expect(editPage).toContain('porState={porState}');
    expect(dealerForms).toContain('<QuotePorReview');
    expect(dealerForms).toContain('<SubmitButton pending={pending} disabled={porBlockers.length > 0} label={');
    expect(dealerForms).toContain("const porSelections = porState.available ? porState.selections : [];");
    // 金額は計算しない（発行の金額は DB が決める）。確認の有無は Server Action で読む
    expect(adminActions).toContain("const porConfirmed = formData.get('por_confirmed') === '1';");
    expect(adminActions).toContain('por_confirmation_keys: porConfirmed ? porKeys : null');
  });

  it('承諾済みの概算から確定見積を作る画面も、確認を記録してから発行する（施工以外の未確定の行は直せないと示す）', () => {
    expect(formalizePage).toContain('const porState = await store.getQuotePorSelections(quote.id, actor);');
    expect(formalizePage).toContain('carriedItems={carriedItems}');
    expect(formalizationForm).toContain('disabled={pending || porBlockers.length > 0}');
    expect(formalizationForm).toContain('この画面では施工の金額だけを入れられるため、この明細は直せません');
    expect(formalizationAction).toContain("db.rpc('confirm_quote_por_selections', {");
    expect(formalizationAction.indexOf("db.rpc('confirm_quote_por_selections'")).toBeLessThan(
      formalizationAction.indexOf("db.rpc('create_formal_quote_from_accepted_preliminary'")
    );
  });

  it('Web 以外の下書きでも、未確定の行が残る間は正式見積を発行できない', () => {
    expect(draftEditor).toContain('unresolvedPorNames.length > 0');
    expect(draftEditor).toContain('data-testid="draft-por-blockers"');
  });
});
