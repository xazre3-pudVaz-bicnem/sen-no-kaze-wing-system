import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260923100000_product_number_identity.sql'),
  'utf8'
);
const types = fs.readFileSync(path.resolve(process.cwd(), 'lib/domain/types.ts'), 'utf8');
const localDb = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/local-db.ts'), 'utf8');
const localStore = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/local-store.ts'), 'utf8');
const actions = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/admin.ts'), 'utf8');
const forms = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/forms.tsx'), 'utf8');

describe('商品管理番号の自動採番', () => {
  it('PRD-6桁をDB側で一意に採番し、既存商品をbackfillする', () => {
    expect(migration).toContain('create sequence if not exists public.product_no_seq');
    expect(migration).toContain('maxvalue 999999');
    expect(migration).toContain('add column if not exists product_no text');
    expect(migration).toContain("order by o.created_at, o.id");
    expect(migration).toContain("'PRD-' || lpad");
    expect(migration).toContain('alter column product_no set not null');
    expect(migration).toContain('options_product_no_unique_idx');
    expect(migration).toContain("product_no ~ '^PRD-[0-9]{6}
  });

  it('商品管理番号はINSERT時にDBが発番し、作成後の変更を拒否する', () => {
    expect(migration).toContain('create or replace function public.assign_option_product_no()');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = pg_catalog, public');
    expect(migration).toContain("if tg_op = 'INSERT'");
    expect(migration).toContain('nextval');
    expect(migration).toContain("LOCKED: 商品管理番号は変更できません");
    expect(migration).toContain('before insert or update of product_no');
    expect(migration).toContain('revoke all on function public.assign_option_product_no() from public');
  });

  it('既存options.codeは互換キーとして残し、登録担当者には入力させない', () => {
    expect(types).toContain('既存Preset / Import互換の技術キー');
    expect(forms).not.toContain('label="管理用コード"');
    expect(forms).not.toContain('id="code-all"');
    expect(forms).toContain('商品管理番号');
    expect(actions).toContain('existingOption?.code');
    expect(actions).toContain('opt-${randomUUID()}');
    expect(actions).toContain('code: internalCode');
  });

  it('ローカル検証モードでも同じPRD形式を割り当て、更新で変えない', () => {
    expect(localDb).toContain('allocateLocalProductNo');
    expect(localDb).toContain("return `PRD-${String(next).padStart(6, '0')}`");
    expect(localDb).toContain('reconcileProductNumbers');
    expect(localStore).toContain('product_no: allocateLocalProductNo(db)');
    expect(localStore).toContain('product_no: _productNo');
  });
});
");
    expect(migration).toContain("product_no <> 'PRD-000000'");
    expect(migration).toContain('revoke all on sequence public.product_no_seq from public, anon, authenticated');
    expect(migration).toContain('greatest(current_max.max_no, sequence_state.last_no)');
  });

  it('商品管理番号はINSERT時にDBが発番し、作成後の変更を拒否する', () => {
    expect(migration).toContain('create or replace function public.assign_option_product_no()');
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public');
    expect(migration).toContain("if tg_op = 'INSERT'");
    expect(migration).toContain('nextval');
    expect(migration).toContain("LOCKED: 商品管理番号は変更できません");
    expect(migration).toContain('before insert or update of product_no');
    expect(migration).toContain('revoke all on function public.assign_option_product_no() from public');
  });

  it('既存options.codeは互換キーとして残し、登録担当者には入力させない', () => {
    expect(types).toContain('既存Preset / Import互換の技術キー');
    expect(forms).not.toContain('label="管理用コード"');
    expect(forms).not.toContain('id="code-all"');
    expect(forms).toContain('商品管理番号');
    expect(actions).toContain('existingOption?.code');
    expect(actions).toContain('opt-${randomUUID()}');
    expect(actions).toContain('code: internalCode');
  });

  it('ローカル検証モードでも同じPRD形式を割り当て、更新で変えない', () => {
    expect(localDb).toContain('allocateLocalProductNo');
    expect(localDb).toContain("return `PRD-${String(next).padStart(6, '0')}`");
    expect(localDb).toContain('reconcileProductNumbers');
    expect(localStore).toContain('product_no: allocateLocalProductNo(db)');
    expect(localStore).toContain('product_no: _productNo');
  });
});
