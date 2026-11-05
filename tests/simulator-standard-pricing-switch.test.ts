import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013210000_simulator_standard_pricing_switch.sql');

describe('サイトの新価格への切り替えスイッチ：DB', () => {
  it('初期値は「切り替えない」で、設定の表は API から直接読み書きできない', () => {
    expect(migration).toContain(`insert into public.app_settings (key, value) values ('simulator_standard_pricing', jsonb_build_object('enabled', false));`);
    expect(migration).toContain('alter table public.app_settings enable row level security;');
    expect(migration).toContain('revoke all on public.app_settings from public, anon, authenticated;');
    expect(migration).not.toMatch(/create policy [a-z_]+ on public\.app_settings/);
    expect(migration).toContain("raise exception 'POSTCONDITION: simulator standard pricing must start disabled';");
  });

  it('DB 側の計算の入口は、スイッチが切れている間これまでの計算（NULL）を返す', () => {
    const body = migration.slice(migration.indexOf('create or replace function public.standard_estimate_sale_view_for_configuration'));
    const gate = body.indexOf('if not public.simulator_standard_pricing_enabled() then');
    expect(gate).toBeGreaterThan(0);
    // 判定は最初に行う（仕様の読み込みより前）
    expect(gate).toBeLessThan(body.indexOf('select * into cfg from public.configurations'));
    expect(body.slice(gate, gate + 120)).toContain('return null;');
  });

  it('切り替えは本部だけ（権限は状態の判定より前）。変更は監査ログに残す', () => {
    const fn = migration.slice(migration.indexOf('create function public.set_simulator_standard_pricing'));
    expect(fn.indexOf('current_role_rank(), 0) < 3')).toBeLessThan(fn.indexOf('insert into public.app_settings'));
    expect(fn).toContain('perform public.write_audit(');
    expect(migration).toContain('grant execute on function public.set_simulator_standard_pricing(boolean) to authenticated;');
    expect(migration).toContain('grant execute on function public.simulator_standard_pricing_enabled() to authenticated, service_role;');
    expect(migration).not.toMatch(/grant execute on function public\.[a-z_]+\([^)]*\) to [^;]*\banon\b/);
    // 内部の計算の入口は、どのロールからも直接は実行できないまま
    expect(migration).toContain(
      'revoke all on function public.standard_estimate_sale_view_for_configuration(uuid) from public, anon, authenticated, service_role;'
    );
    expect(migration).not.toMatch(/grant execute on function public\.standard_estimate_sale_view_for_configuration/);
  });

  it('SECURITY DEFINER の関数は search_path を空にする', () => {
    const definers = migration.match(/create (?:or replace )?function public\.[a-z_]+\([^)]*\)[\s\S]*?as \$/g) ?? [];
    expect(definers.length).toBe(3);
    for (const header of definers) {
      expect(header).toContain('security definer');
      expect(header).toContain("set search_path = ''");
    }
  });
});

describe('サイトの新価格への切り替えスイッチ：画面', () => {
  it('お客様には、スイッチが入っているときだけ新しい標準見積の価格を使う', () => {
    const data = read('lib/data/standard-estimate-sale-views.ts');
    expect(data).toContain("rpc('simulator_standard_pricing_enabled')");
    // スイッチの関数が無い DB（migration 未適用）では安全側（切り替えない）
    expect(data).toContain("if (isMissingNamedFunction(error, 'simulator_standard_pricing_enabled')) return false;");
    expect(data).toContain('if (!switchedOn && !opts.preview) return { saleViews: [], switchedOn, v25: false };');
  });

  it('プレビューは本部の管理者だけ。プレビュー中は保存・見積依頼をしない', () => {
    const page = read('app/(site)/simulator/[slug]/page.tsx');
    const app = read('components/simulator/simulator-app.tsx');
    expect(page).toContain("const previewRequested = preview === 'standard' && user?.role === 'admin';");
    expect(page).toContain('const pricingPreview = previewRequested && !sale.switchedOn;');
    expect(app).toContain('data-testid="pricing-preview-banner"');
    for (const handler of ['const handleSaveClick = () => {', 'const handleQuoteClick = () => {']) {
      const at = app.indexOf(handler);
      expect(app.slice(at, at + 200)).toContain('if (pricingPreview) {');
    }
    const save = app.indexOf('const doSave = (saveName: string');
    expect(app.slice(save, save + 260)).toContain('if (pricingPreview) return;');
  });

  it('管理画面の切り替えは、確認のチェックが無ければ行わない', () => {
    const action = read('lib/actions/standard-estimates.ts');
    const fn = action.slice(action.indexOf('export async function setSimulatorStandardPricingAction'));
    expect(fn.indexOf("await requireAdmin('/admin/standard-estimates')")).toBeGreaterThan(0);
    expect(fn).toContain("if (enabled && formData.get('confirmed') !== 'on') redirect('/admin/standard-estimates?error=switch_confirm');");
    expect(fn).toContain("rpc('set_simulator_standard_pricing', { p_enabled: enabled })");
    expect(fn).toContain('updateTag(CATALOG_TAG);');
  });
});
