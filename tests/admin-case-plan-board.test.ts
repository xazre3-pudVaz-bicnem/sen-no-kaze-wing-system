import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260922050000_case_plan_configuration_read.sql'),
  'utf8'
);
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const casePlan = fs.readFileSync(path.join(root, 'components/admin/case-plan-board.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');

function functionBody(source: string, name: string) {
  const start = source.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end).toBeGreaterThan(0);
  return tail.slice(0, end + 4);
}

describe('案件プランボード', () => {
  it('シミュレーターの主要プラン表示部品をread-onlyで再利用する', () => {
    expect(casePlan).toContain('<PlanBoard');
    expect(casePlan).toContain('<PreviewStage');
    expect(casePlan).toContain('<ElevationStrip');
    expect(casePlan).toContain('<EquipmentBoard');
    expect(casePlan).toContain('<SimulatorCaseImagesProvider');
    expect(casePlan).toContain('readOnly');
    expect(casePlan).toContain('onPickExteriorFace={() => undefined}');
    expect(casePlan).toContain('onPickCategory={() => undefined}');
  });

  it('保存Configurationの選択・色仕様・外壁4面を表示元にする', () => {
    expect(casePlan).toContain('items.map((item) => item.option_id)');
    expect(casePlan).toContain('item.variant_choice_ids ?? []');
    expect(casePlan).toContain('exteriorFaces.length === 0 && hasSelectedExterior');
    expect(casePlan).toContain('normalizeExteriorFaces(');
    expect(casePlan).toContain('resolvePreview(');
    expect(casePlan).toContain('selectedPreviewKeys(');
  });

  it('案件タブで保存仕様を取得しプランボードへ渡す', () => {
    expect(workspace).toContain('store.getCasePlanConfiguration(quote.id, actor)');
    expect(workspace).toContain('<CasePlanBoard');
    expect(workspace).toContain('configuration={casePlanConfiguration.configuration}');
    expect(workspace).toContain('items={casePlanConfiguration.items}');
    expect(workspace).toContain('exteriorFaces={casePlanConfiguration.exterior_faces}');
    expect(workspace).toContain('シミュレーターと同じ表示ロジックで確認します。ここでは変更できません。');
  });

  it('DataStoreの通常Configuration権限を広げず専用読み取り契約を持つ', () => {
    expect(store).toContain('getCasePlanConfiguration(quoteId: string, actor: SessionUser)');
    expect(supabaseStore).toContain("db.rpc('get_case_plan_configuration'");
    expect(localStore).toContain('async getCasePlanConfiguration(quoteId: string, actor: SessionUser)');
    expect(localStore).toContain("const canViewAny = hasRoleAtLeast(actor.role, 'master_dealer');");
    expect(localStore).toContain('quote.dealer_id !== actor.id');
  });

  it('専用RPCはSECURITY DEFINERをhardeningし、顧客と無関係な代理店を拒否する', () => {
    const body = functionBody(migration, 'get_case_plan_configuration');
    expect(body).toContain('security definer');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('v_rank integer := public.current_role_rank();');
    expect(body).toContain('if v_rank < 1 then');
    expect(body).toContain('v_rank >= 2 or (v_rank >= 1 and v_quote.dealer_id = v_uid)');
    expect(body).toContain('from public.quotes');
    expect(body).toContain('from public.configurations');
    expect(body).toContain('from public.configuration_items');
    expect(body).not.toMatch(/\binsert\s+into\b/i);
    expect(body).not.toMatch(/\bupdate\s+public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('専用RPCはAPI全roleから一度剥がしauthenticatedだけへ公開する', () => {
    expect(migration).toContain(
      "revoke execute on function public.get_case_plan_configuration(uuid)\n  from public, anon, authenticated, service_role;"
    );
    expect(migration).toContain(
      'grant execute on function public.get_case_plan_configuration(uuid) to authenticated;'
    );
    expect(migration).not.toContain(
      'grant execute on function public.get_case_plan_configuration(uuid) to service_role;'
    );
    expect(migration).not.toContain('create policy');
    expect(migration).not.toContain('alter policy');
  });

  it('既存migrationより後ろのadditive migrationで、データ更新を行わない', () => {
    expect(Number('20260922050000')).toBeGreaterThan(Number('20260916084500'));
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
