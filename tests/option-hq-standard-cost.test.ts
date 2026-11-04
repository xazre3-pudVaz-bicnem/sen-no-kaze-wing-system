import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014110000_option_hq_standard_cost.sql'),
  'utf8'
);
const action = fs.readFileSync(path.join(root, 'lib/actions/option-hq-standard-cost.ts'), 'utf8');
const data = fs.readFileSync(path.join(root, 'lib/data/option-hq-standard-cost.ts'), 'utf8');
const card = fs.readFileSync(path.join(root, 'components/admin/option-hq-standard-cost-card.tsx'), 'utf8');
const optionLayout = fs.readFileSync(path.join(root, 'app/admin/options/[id]/layout.tsx'), 'utf8');
const optionPage = fs.readFileSync(path.join(root, 'app/admin/options/[id]/page.tsx'), 'utf8');
const ledgerPage = fs.readFileSync(path.join(root, 'app/admin/ledger/page.tsx'), 'utf8');
const ledgerClient = fs.readFileSync(path.join(root, 'components/admin/product-ledger-client.tsx'), 'utf8');

const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('本部商品基準原価', () => {
  it('公開商品とは別テーブルで現在値を保持し、商品削除はRESTRICTする', () => {
    expect(migration).toContain('create table public.option_hq_standard_costs');
    expect(migration).toContain('option_id uuid primary key references public.options(id) on delete restrict');
    expect(migration).toContain('standard_cost integer not null check (standard_cost >= 0)');
    expect(migration).toContain('lock_version integer not null default 1 check (lock_version >= 1)');
    expect(sqlOnly).not.toMatch(/alter\s+table\s+public\.options\s+add[^;]*cost/i);
  });

  it('本部専用の閲覧・更新権限を分け、広い商品編集権限を流用しない', () => {
    expect(migration).toContain('can_view_option_hq_standard_cost');
    expect(migration).toContain('can_manage_option_hq_standard_cost');
    expect(migration).toContain("om.member_role in ('owner', 'admin', 'editor')");
    expect(migration).toContain("om.member_role in ('owner', 'admin')");
    expect(migration).toContain("o.organization_type = 'headquarters'");
    expect(migration).not.toContain('can_edit_catalog()');
  });

  it('機密テーブルはauthenticated SELECT + RLSだけを許可し、直接writeを閉じる', () => {
    expect(migration).toContain('alter table public.option_hq_standard_costs enable row level security;');
    expect(migration).toContain('revoke all on table public.option_hq_standard_costs from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant select on table public.option_hq_standard_costs to authenticated;');
    expect(migration).toContain('using (public.can_view_option_hq_standard_cost());');
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|truncate|references|trigger|maintain|all)\s+on\s+table\s+public\.option_hq_standard_costs/i);
  });

  it('SECURITY DEFINERは空search_path・明示ACL・authと専用権限の再確認を行う', () => {
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('alter function public.set_option_hq_standard_cost(uuid, integer, integer, text) owner to postgres;');
    expect(migration).toContain('revoke all on function public.set_option_hq_standard_cost(uuid, integer, integer, text) from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.set_option_hq_standard_cost(uuid, integer, integer, text) to authenticated;');
    expect(migration).toContain('v_actor uuid := auth.uid();');
    expect(migration).toContain('if not public.can_manage_option_hq_standard_cost() then');
  });

  it('保存はoptions→原価行の順にロックし、expected versionと初回0を強制する', () => {
    const optionLock = migration.indexOf('from public.options o');
    const costLock = migration.indexOf('from public.option_hq_standard_costs c');
    expect(optionLock).toBeGreaterThan(0);
    expect(costLock).toBeGreaterThan(optionLock);
    expect(migration).toContain('if p_expected_lock_version <> 0 then');
    expect(migration).toContain('if v_current.lock_version <> p_expected_lock_version then');
    expect(migration).toContain('lock_version = c.lock_version + 1');
    expect(migration).not.toMatch(/on\s+conflict[\s\S]*do\s+update/i);
  });

  it('未設定と0円を区別し、同額保存はversion・auditを増やさない', () => {
    expect(migration).toContain('standard_cost integer not null');
    expect(migration).toContain('if v_current.standard_cost = p_standard_cost then');
    expect(migration).toContain('return query select v_current.option_id, v_current.standard_cost, v_current.lock_version, false');
    expect(migration).not.toMatch(/coalesce\([^\n]*standard_cost[^\n]*,\s*0\)/i);
  });

  it('変更理由を必須化し、監査ログを同じRPC内でbefore/after保存する', () => {
    expect(migration).toContain("pg_catalog.char_length(v_reason) < 1");
    expect(migration).toContain("pg_catalog.char_length(v_reason) > 500");
    expect(migration).toContain('insert into public.audit_logs');
    expect(migration).toContain("'hq_standard_cost_set'");
    expect(migration).toContain("'hq_standard_cost_update'");
    expect(migration).toContain("'change_reason', v_reason");
    expect(migration).toContain("'product_no', v_option.product_no");
    expect(migration).toContain("'product_name', v_option.name");
  });

  it('アプリ先行配信でも未適用migrationをfail-safeに扱う', () => {
    expect(data).toContain('isMissingFunction');
    expect(data).toContain('isMissingRelation');
    expect(data).toContain('available: false');
    expect(action).toContain('DB_WAIT');
    expect(action).toContain('isMissingFunction(error)');
  });

  it('商品登録STEP1では価格・対象モデルの直後に本部内部情報を置き、固定下部表示をやめる', () => {
    expect(optionPage).toContain('getOptionHqStandardCostAccess');
    expect(optionPage).toContain('OptionHqStandardCostCard');
    expect(optionPage).toContain('data-testid="option-registration-hq-cost"');
    expect(optionPage).toContain('style={{ order: 55 }}');
    expect(optionPage.indexOf('data-testid="option-registration-hq-cost"'))
      .toBeLessThan(optionPage.indexOf('data-testid="option-registration-check"'));
    expect(optionLayout).not.toContain('OptionHqStandardCostCard');
    expect(optionLayout).not.toContain('getOptionHqStandardCostAccess');
    expect(card).toContain('商品標準原価の記録（税別）');
    expect(card).toContain('実仕入価格・案件実原価ではありません');
    expect(card).toContain('既存の見積・発行済みQuoteには自動反映されません');
    // v2.5 PR-A3：入力は「6. 価格・対象モデル」の商品標準原価にひとつにした。カードは記録を見るだけ（二重入力しない）
    expect(card).not.toContain('<form');
    expect(card).not.toContain('expected_lock_version');
    expect(card).toContain('金額は「6. 価格・対象モデル」の商品標準原価（税別）で入力します');
    expect(card).toContain('data-testid="option-hq-standard-cost-mismatch"');
    expect(card).not.toContain(' ／ version ');
  });

  it('商品台帳では許可された本部ユーザーだけ基準原価の項目を受け取る', () => {
    expect(ledgerPage).toContain('getOptionHqStandardCostMap');
    expect(ledgerPage).toContain('hqStandardCosts={hqStandardCosts}');
    expect(ledgerClient).toContain('hqStandardCosts: Record<string, number> | null');
    expect(ledgerClient).toContain('hqStandardCosts !== null');
    expect(ledgerClient).toContain('商品標準原価の記録（税別）');
    expect(ledgerClient).toContain('<Row label="仕入先" value={<PendingDbValue />}/>');
    expect(ledgerClient).toContain('<Row label="発注コード" value={<PendingDbValue />}/>');
    expect(ledgerClient).toContain('<Row label="発注単位" value={<PendingDbValue />}/>');
  });

  it('Standard Estimate / Quoteへの自動連携を今回追加しない', () => {
    expect(migration).not.toMatch(/standard_estimate_revision_lines|quote_draft_items|quote_items/i);
    expect(action).not.toMatch(/standard_estimate|quote/i);
    expect(data).not.toMatch(/standard_estimate|quote/i);
  });
});
