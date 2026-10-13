import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013140000_base_master_matrix_identity.sql');
const createSource = read('supabase/migrations/20260914143000_base_master_draft_publish.sql');
const actions = read('lib/actions/base-masters.ts');
const form = read('components/admin/base-master-form.tsx');
const page = read('app/admin/base-masters/page.tsx');
const runtime = read('scripts/db-rehearsal/runtime-security.sql');

/** migration の `v_xxx constant text := E'...'` を SQL と同じ規則で文字列へ戻す */
function textConstant(name: string): string {
  const declaration = migration.match(new RegExp(`${name} constant text :=([^;]*);`));
  expect(declaration, name).not.toBeNull();
  return [...declaration![1].matchAll(/(E?)'((?:[^'\\]|''|\\.)*)'/g)]
    .map(([, escape, text]) => {
      const unquoted = text.split("''").join("'");
      return escape ? unquoted.split('\\n').join('\n') : unquoted;
    })
    .join('');
}

describe('本体マスターの identity（組織 × 機種・用途・サイズ × 防火）', () => {
  it('行を持たせ、有効な本体は組織 × 行 × 防火で一意にする', () => {
    expect(migration).toContain('add column matrix_row_id uuid references public.matrix_rows(id) on delete restrict;');
    expect(migration).toContain('on public.base_masters (owner_organization_id, matrix_row_id, fire_spec_code)');
    expect(migration).toContain("where status = 'active' and matrix_row_id is not null;");
  });

  it('行の必須・有効性・機種の一致・防火可否・公開後の行変更をトリガーで検査する（fail closed）', () => {
    for (const message of [
      'VALIDATION: 本体には仕様マトリクスの行（機種・用途・サイズ）を指定してください',
      'VALIDATION: 有効な仕様マトリクスの行を指定してください',
      'VALIDATION: 仕様マトリクスの行と本体の商品モデルが一致しません',
      'VALIDATION: この仕様（機種・用途・サイズ）では防火の本体を作成できません',
      'LOCKED: 公開履歴のある本体は仕様マトリクスの行を変更できません',
    ]) {
      expect(migration).toContain(message);
    }
    expect(migration).toContain("if new.fire_spec_code = 'fire' and not v_row.fire_selectable then");
    expect(migration).toContain('before insert or update of matrix_row_id, base_model_id, fire_spec_code on public.base_masters');
  });

  it('作成 RPC は適用済みの定義から引数と insert の列・値だけを変える（目印はちょうど 1 箇所）', () => {
    const start = createSource.indexOf('create or replace function public.create_base_master_draft(');
    const body = createSource.slice(start, createSource.indexOf('$$;', createSource.indexOf('as $$', start)));
    for (const name of ['v_columns_old', 'v_values_old']) {
      expect(body.split(textConstant(name)).length - 1, name).toBe(1);
    }
    expect(body).not.toContain('matrix_row_id');
    expect(textConstant('v_columns_new')).toBe(textConstant('v_columns_old').replace('    status,', '    matrix_row_id,\n    status,'));
    expect(textConstant('v_values_new')).toBe(textConstant('v_values_old').replace("    'active',", "    p_matrix_row_id,\n    'active',"));
    expect(migration).toContain("', p_matrix_row_id uuid DEFAULT NULL::uuid'");
    expect(migration).toContain("execute 'drop function public.create_base_master_draft(uuid, uuid, text, text, uuid)';");
    expect(migration).toContain('grant execute on function public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid) to authenticated;');
    expect(migration).toContain('exactly one create_base_master_draft must exist');
  });

  it('画面は機種・用途・サイズ（マトリクスの行）を選び、商品モデルはサーバー側で行から決める', () => {
    expect(actions).toContain("matrix_row_id: z.uuid('機種・用途・サイズを選択してください'),");
    expect(actions).toContain(".from('matrix_rows')");
    expect(actions).toContain('p_base_model_id: matrixRow.base_model_id,');
    expect(actions).toContain('p_matrix_row_id: parsed.data.matrix_row_id,');
    expect(form).toContain('name="matrix_row_id"');
    expect(form).toContain("{row.fireSelectable ? '' : '（防火不可）'}");
    expect(page).toContain('const specMatrix = await store.getSpecMatrix();');
    expect(page).toContain('<BaseMasterCreateForm matrixRows={matrixRowOptions} organizations={editableOrganizations} />');
  });

  it('実行時検査で、防火不可の行・機種の不一致・行なし・identity の重複を拒否することを確認している', () => {
    for (const step of [
      '11-1 防火を選べない行では、防火の本体を作れない',
      '11-2 行と商品モデルが違う本体は作れない',
      '11-3 行（機種・用途・サイズ）の指定が無い本体は作れない',
      '11-4 防火を選べる行では、防火の本体を作れる',
      '11-5 同じ組織 × 行 × 防火の本体は 2 つ作れない',
      '11-8 作られた本体はすべて行を持ち、identity が重複していない',
    ]) {
      expect(runtime).toContain(step);
    }
  });
});
