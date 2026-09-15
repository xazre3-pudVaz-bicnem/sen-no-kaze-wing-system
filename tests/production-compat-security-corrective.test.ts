import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationPath = path.join(
  root,
  'supabase/migrations/20260915062400_production_compat_security_corrective.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const simulator = fs.readFileSync(path.join(root, 'components/simulator/simulator-app.tsx'), 'utf8');
const exteriorDialog = fs.readFileSync(path.join(root, 'components/simulator/exterior-wall-faces-dialog.tsx'), 'utf8');
const adminQuote = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');
const quoteResponseMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/0012_notifications_audit.sql'),
  'utf8'
);
const standardEstimateMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911050000_standard_estimate_simulator.sql'),
  'utf8'
);

const insulationSection = migration.slice(
  migration.indexOf('-- 1. Wing既存Draft'),
  migration.indexOf('-- 2. 既存外壁1商品')
);
const exteriorSection = migration.slice(
  migration.indexOf('-- 2. 既存外壁1商品'),
  migration.indexOf('-- 3. SECURITY DEFINER')
);
const securitySection = migration.slice(
  migration.indexOf('-- 3. SECURITY DEFINER'),
  migration.indexOf('-- 4. Quote Revision lifecycle')
);
const quoteSection = migration.slice(migration.indexOf('-- 4. Quote Revision lifecycle'));

describe('production compatibility / security corrective migration', () => {
  it('現在mainの最新migrationより後ろのforward-only migrationとして追加されている', () => {
    expect(path.basename(migrationPath)).toBe('20260915062400_production_compat_security_corrective.sql');
    expect(fs.existsSync(path.join(root, 'supabase/migrations/20260915030000_option_media.sql'))).toBe(true);
    expect('20260915062400').toBeGreaterThan('20260915030000');
  });

  it('Wing Draftだけを対象にrequired断熱を不足categoryだけ補完する', () => {
    expect(insulationSection).toContain("cfg.base_model_id = '10000000-0000-4000-8000-000000000001'::uuid");
    expect(insulationSection).toContain("cfg.status = 'draft'");
    expect(insulationSection).toContain('insert into public.configuration_items');
    expect(insulationSection).toContain("existing_category.code = wanted.category_code");
    expect(insulationSection).toContain('not exists (');
    expect(insulationSection).toContain('on conflict (configuration_id, option_id) do nothing');
    expect(insulationSection).not.toMatch(/status\s*(?:<>|!=)\s*'draft'/);
  });

  it('spec_code=nullはhotelへfallbackし、spec_code自体は更新しない', () => {
    expect(insulationSection).toContain("coalesce(cfg.spec_code, 'hotel')");
    expect(insulationSection).toContain("when 'hotel' then 'insulation-wall-styrofoam-90-hotel-base'");
    expect(insulationSection).toContain("when 'residence' then 'insulation-wall-glasswool-90-standard'");
    expect(insulationSection).toContain("when 'office' then 'insulation-wall-glasswool-90-standard'");
    expect(insulationSection).not.toMatch(/update\s+public\.configurations[\s\S]*?spec_code\s*=/i);
  });

  it('断熱標準optionをpublished・0円・price_on_request=false・required category・Wing適用可能で事前検証する', () => {
    for (const code of [
      'insulation-floor-mirafoam-90',
      'insulation-wall-styrofoam-90-hotel-base',
      'insulation-wall-glasswool-90-standard',
      'insulation-ceiling-styrofoam-90-hotel-base',
      'insulation-ceiling-glasswool-90-standard',
    ]) {
      expect(insulationSection).toContain(code);
    }
    expect(insulationSection).toContain("o.status = 'published'");
    expect(insulationSection).toContain('o.price = 0');
    expect(insulationSection).toContain('o.price_on_request = false');
    expect(insulationSection).toContain("c.status = 'published'");
    expect(insulationSection).toContain('c.is_required = true');
    expect(insulationSection).toContain("o.base_model_id = '10000000-0000-4000-8000-000000000001'::uuid");
    expect(insulationSection).toContain('raise exception');
  });

  it('断熱backfillはConfiguration金額列を更新せずrecalculateも呼ばない', () => {
    expect(insulationSection).not.toMatch(/update\s+public\.configurations/i);
    expect(insulationSection).not.toContain('perform public.recalculate_configuration');
    for (const column of [
      'base_price =',
      'base_expense =',
      'option_subtotal =',
      'option_expense =',
      'installation_subtotal =',
      'adjustment =',
      'subtotal =',
      'tax =',
      'total =',
    ]) {
      expect(insulationSection).not.toContain(column);
    }
  });

  it('断熱backfillは既存categoryを上書きせず再実行時に追加0件となる形を持つ', () => {
    expect(insulationSection).toContain('not exists (');
    expect(insulationSection).toContain('existing_item.configuration_id = cfg.id');
    expect(insulationSection).toContain('existing_category.code = wanted.category_code');
    expect(insulationSection).toContain('on conflict (configuration_id, option_id) do nothing');
    expect(insulationSection).not.toMatch(/update\s+public\.configuration_items/i);
  });

  it('旧外壁はexterior_faces空かつ代表行1件だけを同じoption/variantのまま4面化する', () => {
    expect(exteriorSection).toContain('count(*) over (partition by ci.configuration_id) as wall_count');
    expect(exteriorSection).toContain('wi.wall_count = 1');
    expect(exteriorSection).toContain("coalesce(cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb");
    expect(exteriorSection).toContain("'face_code', 'front'");
    expect(exteriorSection).toContain("'face_code', 'right'");
    expect(exteriorSection).toContain("'face_code', 'back'");
    expect(exteriorSection).toContain("'face_code', 'left'");
    expect(exteriorSection.match(/'option_id', t\.option_id::text/g)).toHaveLength(4);
    expect(exteriorSection.match(/to_jsonb\(t\.variant_choice_ids\)/g)).toHaveLength(4);
  });

  it('旧外壁の実効数値価格が0円でなければ4面backfill前にmigrationを停止する', () => {
    expect(exteriorSection).toContain('case when o.price_on_request then 0 else o.price end');
    expect(exteriorSection).toContain('case when vc.price_on_request then 0 else vc.extra_price end');
    expect(exteriorSection).toMatch(/\)\s*<>\s*0;/);
    expect(exteriorSection).toContain('legacy exterior-wall configuration(s) have non-zero effective price');
    expect(exteriorSection.indexOf('non-zero effective price')).toBeLessThan(
      exteriorSection.indexOf('update public.configurations cfg')
    );
  });

  it('外壁backfillは代表configuration_item・Quote・Configuration金額を変更せず再計算しない', () => {
    expect(exteriorSection).not.toMatch(/delete\s+from\s+public\.configuration_items/i);
    expect(exteriorSection).not.toMatch(/update\s+public\.quotes/i);
    expect(exteriorSection).not.toMatch(/update\s+public\.quote_items/i);
    expect(exteriorSection).not.toContain('recalculate_configuration(');
    expect(exteriorSection).toContain('set exterior_faces = jsonb_build_array(');
    for (const column of [
      'base_price =',
      'base_expense =',
      'option_subtotal =',
      'option_expense =',
      'installation_subtotal =',
      'adjustment =',
      'subtotal =',
      'tax =',
      'total =',
    ]) {
      expect(exteriorSection).not.toContain(column);
    }
  });

  it('4面設定時は既存代表外壁を価格集計から除外して二重計上しない', () => {
    expect(standardEstimateMigration).toContain(
      "and not (v_has_faces and cat.code = 'exterior-wall');"
    );
    expect(standardEstimateMigration).toContain(
      "if p_section = 'interior_exterior' and v_has_faces then"
    );
  });

  it('保存済みlegacy外壁は復元表示でき、新規選択候補からは引き続き除外する', () => {
    expect(simulator).toContain("const legacyExteriorCodes = new Set(['exterior-galnote', 'exterior-wood']);");
    expect(simulator).toContain('allExteriorWallOptions.filter((option) => !legacyExteriorCodes.has(option.code))');
    expect(simulator).toContain('initial?.exterior_faces,\n      allExteriorWallOptions,');
    expect(simulator).toContain('draft.exteriorFaces,\n              allExteriorWallOptions,');
    expect(simulator).toContain('restorableOptions={allExteriorWallOptions}');
    expect(exteriorDialog).toContain('normalizeExteriorFaces(current, restorableOptions');
    expect(exteriorDialog).toContain('restorableOptions.find((o) => o.id === active?.option_id)');
    expect(exteriorDialog).toContain('options={options}');
  });

  it('外壁ダイアログを開くだけでは親状態へ適用せず、Apply時だけ変更する', () => {
    expect(exteriorDialog).toContain('const [faces, setFaces] = useState<ExteriorFaceSelection[]>(normalized);');
    expect(exteriorDialog).toContain('onClick={() => onApply(faces)}');
    expect(exteriorDialog).not.toMatch(/useEffect\([\s\S]{0,300}onApply/);
  });

  it('SECURITY DEFINER wrapper自身がcan_edit_catalogを検証しsearch_pathを空にする', () => {
    expect(securitySection).toContain('create or replace function public.replace_estimate_templates_with_baselines');
    expect(securitySection).toContain("security definer\nset search_path = ''");
    expect(securitySection).toContain('if not public.can_edit_catalog() then');
    expect(securitySection).toContain('perform public.replace_estimate_templates(p_templates);');
  });

  it('対象SECURITY DEFINERのsearch_pathを空に固定する', () => {
    for (const signature of [
      'public.replace_estimate_templates(jsonb)',
      'public.configuration_master_section_total(uuid, text)',
      'public.estimate_baseline_master_section_total(uuid, text)',
      'public.recalculate_configuration(uuid)',
      'public.create_quote_from_configuration(uuid, jsonb, text)',
      'public.respond_to_quote(uuid, text)',
    ]) {
      expect(securitySection).toContain(`alter function ${signature} set search_path = '';`);
    }
    expect(quoteSection).toContain("security definer\nset search_path = ''");
  });

  it('内部helperはAPI role/service_roleからEXECUTE不可にしregrantしない', () => {
    for (const signature of [
      'public.replace_estimate_templates(jsonb)',
      'public.configuration_master_section_total(uuid, text)',
      'public.estimate_baseline_master_section_total(uuid, text)',
    ]) {
      expect(migration).toContain(
        `revoke execute on function ${signature}\n  from public, anon, authenticated, service_role;`
      );
      expect(migration).not.toContain(`grant execute on function ${signature} to authenticated;`);
      expect(migration).not.toContain(`grant execute on function ${signature} to service_role;`);
    }
  });

  it('外部RPCはPUBLIC/anon/authenticated/service_roleを一度REVOKEしauthenticatedだけ再grantする', () => {
    for (const signature of [
      'public.replace_estimate_templates_with_baselines(jsonb)',
      'public.recalculate_configuration(uuid)',
      'public.create_quote_from_configuration(uuid, jsonb, text)',
      'public.create_quote_revision(uuid, jsonb, text)',
      'public.respond_to_quote(uuid, text)',
    ]) {
      expect(migration).toContain(
        `revoke execute on function ${signature}\n  from public, anon, authenticated, service_role;`
      );
      expect(migration).toContain(`grant execute on function ${signature} to authenticated;`);
      expect(migration).not.toContain(`grant execute on function ${signature} to service_role;`);
    }
  });

  it('Quote RevisionはFOR UPDATEを維持しparent.status=issuedだけをallowlistする', () => {
    expect(quoteSection).toMatch(/from public\.quotes[\s\S]*?where id = p_quote_id[\s\S]*?for update;/);
    expect(quoteSection).toContain("if parent.status <> 'issued' then");
    expect(quoteSection).toContain('改訂できるのは発行中（issued）の見積だけです');
    expect(quoteSection.indexOf("if parent.status <> 'issued' then")).toBeLessThan(
      quoteSection.indexOf('insert into public.quotes(')
    );
  });

  it('AcceptとRevisionは同じQuote行をFOR UPDATEし、どちらもissued以外を拒否する', () => {
    expect(quoteResponseMigration).toMatch(/select \* into q from public\.quotes where id = p_quote_id for update;/);
    expect(quoteResponseMigration).toContain("if q.status <> 'issued' then");
    expect(quoteSection).toContain("if parent.status <> 'issued' then");
  });

  it('accepted等の既存Quoteをmigration適用だけで更新せず、UIもissuedだけ改訂可にする', () => {
    const beforeFunction = migration.slice(0, migration.indexOf('create or replace function public.create_quote_revision'));
    expect(beforeFunction).not.toMatch(/update\s+public\.quotes/i);
    expect(migration).not.toMatch(/update\s+public\.quotes[\s\S]{0,120}where[\s\S]{0,80}status\s*=\s*'accepted'/i);
    expect(adminQuote).toContain(
      "const canRevise = quote.status === 'issued' && (canManageAllQuotes || quote.dealer_id === actor.id);"
    );
    expect(localStore).toContain("if (parent.status !== 'issued') {");
  });
});
