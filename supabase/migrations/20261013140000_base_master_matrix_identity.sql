-- PR D1：本体マスターの identity を「組織 × 機種 × 仕様 × サイズ × 防火」にする。
--
-- 統合版依頼書 §12「identity が owner × model × spec × size × fire で一意」、初期登録資料（Base Master 初期整理）の
-- 「用途別・防火別 Base Master」に合わせる。機種 × 仕様 × サイズは PR A の本体仕様マトリクスの行で表す。
--
--   * base_masters.matrix_row_id を追加する
--   * 新しく作る本体マスター・identity を変える本体マスターは、有効なマトリクスの行を必ず持つ
--     （行・仕様・サイズが active で、行の機種と本体の機種が一致すること）
--   * 防火を選べない行（fire_selectable = false。初期は Flat 事務所）では、防火の本体マスターを作れない
--   * 有効な本体マスターは「組織 × 行 × 防火」で一意
--   * 公開履歴のある本体マスターは、行を変えられない（既存の identity ガードと同じ扱い）
--   * create_base_master_draft に p_matrix_row_id を追加する
--     （適用済みの定義を検査してから、引数と insert の列・値の 3 箇所だけを変える）
--
-- 本番には本体マスターの表がまだ無い（未適用）。行が未設定の既存行がある DB でも、そのまま読めるが、
-- identity を変える更新では行の設定を求める。
-- 旧本体の移行 Draft（20260915003301）は行を持たないため、この後は作成できない。初期登録は確定資料（xlsx）から行う。

begin;

-- ---------- preflight ----------

do $$
begin
  if to_regclass('public.matrix_rows') is null then
    raise exception 'PRECONDITION: matrix foundation (PR A) must be applied first';
  end if;
  if to_regprocedure('public.create_base_master_draft(uuid, uuid, text, text, uuid)') is null then
    raise exception 'PRECONDITION: create_base_master_draft (5 arguments) is missing; review migration order';
  end if;
  if to_regprocedure('public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid)') is not null then
    raise exception 'PRECONDITION: create_base_master_draft with matrix row already exists';
  end if;
end;
$$;

-- ---------- identity ----------

alter table public.base_masters
  add column matrix_row_id uuid references public.matrix_rows(id) on delete restrict;

comment on column public.base_masters.matrix_row_id is
  '本体仕様マトリクスの行（機種 × 仕様 × サイズ）。本体マスターの identity は組織 × 行 × 防火。';

create unique index base_masters_active_identity_key
  on public.base_masters (owner_organization_id, matrix_row_id, fire_spec_code)
  where status = 'active' and matrix_row_id is not null;

create function public.enforce_base_master_matrix_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.matrix_rows;
begin
  if tg_op = 'UPDATE'
     and new.matrix_row_id is not distinct from old.matrix_row_id
     and new.base_model_id is not distinct from old.base_model_id
     and new.fire_spec_code is not distinct from old.fire_spec_code then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.matrix_row_id is distinct from old.matrix_row_id
     and exists (
       select 1 from public.base_master_revisions r
        where r.base_master_id = old.id and r.status in ('published', 'superseded')
     ) then
    raise exception 'LOCKED: 公開履歴のある本体は仕様マトリクスの行を変更できません' using errcode = 'P0001';
  end if;

  if new.matrix_row_id is null then
    raise exception 'VALIDATION: 本体には仕様マトリクスの行（機種・用途・サイズ）を指定してください' using errcode = 'P0001';
  end if;

  select r.* into v_row
    from public.matrix_rows r
    join public.matrix_specs s on s.code = r.spec_code and s.status = 'active'
    join public.matrix_sizes z on z.code = r.size_code and z.status = 'active'
   where r.id = new.matrix_row_id
     and r.status = 'active';
  if not found then
    raise exception 'VALIDATION: 有効な仕様マトリクスの行を指定してください' using errcode = 'P0001';
  end if;

  if v_row.base_model_id is distinct from new.base_model_id then
    raise exception 'VALIDATION: 仕様マトリクスの行と本体の商品モデルが一致しません' using errcode = 'P0001';
  end if;

  if new.fire_spec_code = 'fire' and not v_row.fire_selectable then
    raise exception 'VALIDATION: この仕様（機種・用途・サイズ）では防火の本体を作成できません' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter function public.enforce_base_master_matrix_identity() owner to postgres;
revoke all on function public.enforce_base_master_matrix_identity() from public, anon, authenticated, service_role;

create trigger base_masters_matrix_identity
before insert or update of matrix_row_id, base_model_id, fire_spec_code on public.base_masters
for each row execute function public.enforce_base_master_matrix_identity();

-- ---------- create RPC ----------

do $create_rpc$
declare
  v_old_signature constant text := 'public.create_base_master_draft(uuid, uuid, text, text, uuid)';
  v_new_signature constant text := 'public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid)';
  v_columns_old constant text := E'    fire_spec_code,\n    status,\n';
  v_columns_new constant text := E'    fire_spec_code,\n    matrix_row_id,\n    status,\n';
  v_values_old constant text := E'    p_fire_spec_code,\n    ''active'',\n';
  v_values_new constant text := E'    p_fire_spec_code,\n    p_matrix_row_id,\n    ''active'',\n';
  v_args_end constant text := E')\n RETURNS uuid\n';
  v_old_oid oid;
  v_new_oid oid;
  v_definition text;
  v_expected text;
  v_args_at integer;
  v_before record;
  v_after record;
begin
  v_old_oid := to_regprocedure(v_old_signature);
  select p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_old_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_old_oid);

  if (length(v_definition) - length(replace(v_definition, v_columns_old, ''))) / length(v_columns_old) <> 1
     or (length(v_definition) - length(replace(v_definition, v_values_old, ''))) / length(v_values_old) <> 1
     or (length(v_definition) - length(replace(v_definition, v_args_end, ''))) / length(v_args_end) <> 1
     or position('matrix_row_id' in v_definition) > 0 then
    raise exception 'PRECONDITION: % differs from the reviewed definition', v_old_signature;
  end if;

  v_args_at := position(v_args_end in v_definition);
  v_expected := substr(v_definition, 1, v_args_at - 1) || ', p_matrix_row_id uuid DEFAULT NULL::uuid' || substr(v_definition, v_args_at);
  v_expected := replace(replace(v_expected, v_columns_old, v_columns_new), v_values_old, v_values_new);

  execute 'drop function public.create_base_master_draft(uuid, uuid, text, text, uuid)';
  execute v_expected;

  v_new_oid := to_regprocedure(v_new_signature);
  if v_new_oid is null or pg_catalog.pg_get_functiondef(v_new_oid) is distinct from v_expected then
    raise exception 'POSTCONDITION: % was not created as expected', v_new_signature;
  end if;
  select p.prosecdef, p.proconfig into v_after from pg_catalog.pg_proc p where p.oid = v_new_oid;
  if v_after.prosecdef is distinct from v_before.prosecdef or v_after.proconfig is distinct from v_before.proconfig then
    raise exception 'POSTCONDITION: SECURITY DEFINER / search_path of % changed unexpectedly', v_new_signature;
  end if;
end;
$create_rpc$;

alter function public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid) owner to postgres;
revoke execute on function public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn constant regprocedure := 'public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid)'::regprocedure;
begin
  if (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_base_master_draft') <> 1 then
    raise exception 'POSTCONDITION: exactly one create_base_master_draft must exist';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p where p.oid = v_fn and (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' or not p.prosecdef)) then
    raise exception 'POSTCONDITION: create_base_master_draft must be a postgres-owned SECURITY DEFINER function';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'POSTCONDITION: create_base_master_draft must be executable by authenticated only';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.base_masters'::regclass and t.tgname = 'base_masters_matrix_identity' and not t.tgisinternal) then
    raise exception 'POSTCONDITION: base_masters_matrix_identity trigger is missing';
  end if;
end;
$postcondition$;

commit;
