-- PR D2：本体仕様マトリクスを管理画面（本部）から変更する RPC。
--
-- PR A の確定 seed の後の変更は、この RPC だけで行う（API ロールの直接書き込みは PR A で閉じている）。
--   * update_matrix_row … 行の防火可否と、項目ごとの選択可否を保存する（lock_version で同時編集を検知）
--   * create_matrix_row … 既存の仕様・サイズで行を追加する（全項目のセルを明示的に作る）
--   * set_matrix_row_status … 行を停止（retired）・再開（active）する
-- いずれも本部だけ（権限確認は状態判定より前）。変更は監査ログに残す。
-- 防火の本体（有効な本体マスター）がある行は、防火不可へ変更できない（本体マスターの identity と食い違うため）。
-- 既存の Quote / Snapshot / Configuration の保存値は変更しない（Draft の保存・見積依頼だけが新しい可否で検査される）。

begin;

create function public.update_matrix_row(
  p_row_id uuid,
  p_fire_selectable boolean,
  p_selectable_items text[],
  p_expected_lock_version integer
)
returns public.matrix_rows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.matrix_rows;
  v_before jsonb;
  v_unknown text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 本体仕様マトリクスを変更できるのは本部だけです' using errcode = '42501';
  end if;
  if p_fire_selectable is null or p_selectable_items is null then
    raise exception 'VALIDATION: 防火の可否と選択できる項目を指定してください' using errcode = 'P0001';
  end if;

  select string_agg(code, ', ') into v_unknown
    from unnest(p_selectable_items) as given(code)
   where not exists (select 1 from public.matrix_items i where i.code = given.code and i.status = 'active');
  if v_unknown is not null then
    raise exception 'VALIDATION: 有効な項目ではありません（%）', v_unknown using errcode = 'P0001';
  end if;

  select * into r from public.matrix_rows where id = p_row_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの行が更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
  end if;
  if r.fire_selectable and not p_fire_selectable and exists (
    select 1 from public.base_masters b
     where b.matrix_row_id = r.id and b.fire_spec_code = 'fire' and b.status = 'active'
  ) then
    raise exception 'LOCKED: この行には有効な防火の本体があります。防火不可にする前に本体を整理してください' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'fire_selectable', r.fire_selectable,
           'selectable_items', coalesce((select jsonb_agg(c.matrix_item_code order by c.matrix_item_code)
                                           from public.matrix_cells c where c.matrix_row_id = r.id and c.selectable), '[]'::jsonb))
    into v_before;

  -- 有効な項目すべてのセルを明示的に持たせる（列挙していない項目は選択不可）。retired の項目のセルは触らない
  insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
  select r.id, i.code, i.code = any(p_selectable_items)
    from public.matrix_items i
   where i.status = 'active'
  on conflict (matrix_row_id, matrix_item_code) do update set selectable = excluded.selectable;

  update public.matrix_rows
     set fire_selectable = p_fire_selectable,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = r.id
  returning * into r;

  perform public.write_audit('matrix_row.update', 'matrix_rows', r.id, '本体仕様マトリクスの行を変更', v_before,
    jsonb_build_object('fire_selectable', r.fire_selectable,
                       'selectable_items', (select jsonb_agg(code order by code) from unnest(p_selectable_items) as code)));
  return r;
end;
$$;

create function public.create_matrix_row(
  p_base_model_id uuid,
  p_spec_code text,
  p_size_code text,
  p_fire_selectable boolean,
  p_selectable_items text[]
)
returns public.matrix_rows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.matrix_rows;
  v_unknown text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 本体仕様マトリクスを変更できるのは本部だけです' using errcode = '42501';
  end if;
  if p_fire_selectable is null or p_selectable_items is null then
    raise exception 'VALIDATION: 防火の可否と選択できる項目を指定してください' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.base_models m where m.id = p_base_model_id) then
    raise exception 'VALIDATION: 機種が見つかりません' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.matrix_specs s where s.code = p_spec_code and s.status = 'active') then
    raise exception 'VALIDATION: 有効な仕様ではありません' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.matrix_sizes z where z.code = p_size_code and z.status = 'active') then
    raise exception 'VALIDATION: 有効なサイズではありません' using errcode = 'P0001';
  end if;
  select string_agg(code, ', ') into v_unknown
    from unnest(p_selectable_items) as given(code)
   where not exists (select 1 from public.matrix_items i where i.code = given.code and i.status = 'active');
  if v_unknown is not null then
    raise exception 'VALIDATION: 有効な項目ではありません（%）', v_unknown using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.matrix_rows x
     where x.base_model_id = p_base_model_id and x.spec_code = p_spec_code and x.size_code = p_size_code
  ) then
    raise exception 'LOCKED: 同じ機種・仕様・サイズの行がすでにあります（停止中なら再開してください）' using errcode = 'P0001';
  end if;

  insert into public.matrix_rows (base_model_id, spec_code, size_code, fire_selectable, created_by, updated_by)
  values (p_base_model_id, p_spec_code, p_size_code, p_fire_selectable, v_uid, v_uid)
  returning * into r;

  insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
  select r.id, i.code, i.code = any(p_selectable_items)
    from public.matrix_items i
   where i.status = 'active';

  perform public.write_audit('matrix_row.create', 'matrix_rows', r.id, '本体仕様マトリクスの行を追加', null,
    jsonb_build_object('base_model_id', r.base_model_id, 'spec_code', r.spec_code, 'size_code', r.size_code,
                       'fire_selectable', r.fire_selectable,
                       'selectable_items', (select jsonb_agg(code order by code) from unnest(p_selectable_items) as code)));
  return r;
end;
$$;

create function public.set_matrix_row_status(
  p_row_id uuid,
  p_status text,
  p_expected_lock_version integer
)
returns public.matrix_rows
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r public.matrix_rows;
  v_before text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: 本体仕様マトリクスを変更できるのは本部だけです' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'retired') then
    raise exception 'VALIDATION: 状態が不正です' using errcode = 'P0001';
  end if;

  select * into r from public.matrix_rows where id = p_row_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの行が更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
  end if;

  v_before := r.status;
  update public.matrix_rows
     set status = p_status,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = r.id
  returning * into r;

  perform public.write_audit('matrix_row.status', 'matrix_rows', r.id,
    case when p_status = 'retired' then '本体仕様マトリクスの行を停止' else '本体仕様マトリクスの行を再開' end,
    jsonb_build_object('status', v_before), jsonb_build_object('status', r.status));
  return r;
end;
$$;

alter function public.update_matrix_row(uuid, boolean, text[], integer) owner to postgres;
alter function public.create_matrix_row(uuid, text, text, boolean, text[]) owner to postgres;
alter function public.set_matrix_row_status(uuid, text, integer) owner to postgres;

revoke all on function public.update_matrix_row(uuid, boolean, text[], integer) from public, anon, authenticated, service_role;
revoke all on function public.create_matrix_row(uuid, text, text, boolean, text[]) from public, anon, authenticated, service_role;
revoke all on function public.set_matrix_row_status(uuid, text, integer) from public, anon, authenticated, service_role;

grant execute on function public.update_matrix_row(uuid, boolean, text[], integer) to authenticated;
grant execute on function public.create_matrix_row(uuid, text, text, boolean, text[]) to authenticated;
grant execute on function public.set_matrix_row_status(uuid, text, integer) to authenticated;

do $postcondition$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.update_matrix_row(uuid, boolean, text[], integer)'::regprocedure,
    'public.create_matrix_row(uuid, text, text, boolean, text[])'::regprocedure,
    'public.set_matrix_row_status(uuid, text, integer)'::regprocedure
  ]
  loop
    if exists (select 1 from pg_catalog.pg_proc p where p.oid = v_fn
                and (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres' or not p.prosecdef or not ('search_path=""' = any(p.proconfig)))) then
      raise exception 'POSTCONDITION: % must be a postgres-owned SECURITY DEFINER function with an empty search_path', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
    end if;
  end loop;
end;
$postcondition$;

commit;
