-- 下書き商品の未使用選択項目・選択肢だけを安全削除する。
-- 既存の商品削除guardの利用により、Configuration / Quote / Revision / Snapshot /
-- 本体Preset / 商品ルールで一度も使用していない「商品」だけが対象。
-- これは意図的に保守的な条件。特定選択肢が未使用でも商品が使用済みなら削除しない。
-- 本番のmigration適用と実DB競合試験は別工程。既存migrationは編集しない。

do $preflight$
begin
  if to_regprocedure('public.assert_option_unreferenced(uuid, text)') is null
     or to_regprocedure('public.can_edit_catalog()') is null then
    raise exception 'PREFLIGHT: hardened product reference guard is required before variant safe-delete';
  end if;
  if to_regclass('public.option_variant_groups') is null
     or to_regclass('public.option_variant_choices') is null then
    raise exception 'PREFLIGHT: variant tables are missing';
  end if;
end;
$preflight$;

-- 通常のData API経由でDELETEさせない。登録画面の権限とDB側権限を分離する。
-- 既存のINSERT/UPDATE/SELECTや、postgres所有の従来RPC・FK CASCADEは変更しない。
revoke delete, truncate on table public.option_variant_groups from public, anon, authenticated, service_role;
revoke delete, truncate on table public.option_variant_choices from public, anon, authenticated, service_role;

create or replace function public.delete_unused_variant_choice(
  p_option_id uuid, p_choice_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_option_code text;
  v_group_id uuid;
  v_group_code text;
  v_choice_code text;
  v_busy constant text := 'LOCKED: ほかの保存処理と重なったため削除しませんでした';
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.can_edit_catalog() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN: 商品編集権限がありません';
  end if;

  -- 先に商品行をロックする。Draft→Publishedの競合を先に直列化する。
  select o.code into v_option_code
    from public.options o
   where o.id = p_option_id and o.status = 'draft'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 下書き商品だけ削除できます';
  end if;

  -- 同じtransactionで全商品参照を検査し、非FK/JSON/配列の書込みを防ぐ。
  -- 他のテーブルが使用中なら既存guard側が安全に停止する。
  perform public.assert_option_unreferenced(p_option_id, v_option_code);

  select vc.group_id, vg.code, vc.code
    into v_group_id, v_group_code, v_choice_code
    from public.option_variant_choices vc
    join public.option_variant_groups vg on vg.id = vc.group_id
   where vc.id = p_choice_id and vg.option_id = p_option_id
   for update of vc, vg;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND: 対象の選択肢がありません';
  end if;

  -- 別の選択項目の表示条件は選択肢codeを配列参照している（FKなし）。
  if exists (
    select 1 from public.option_variant_groups child
     where child.option_id = p_option_id
       and child.id <> v_group_id
       and child.depends_on_group_code = v_group_code
       and v_choice_code = any(coalesce(child.depends_on_choice_codes, '{}'::text[]))
  ) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 別の選択項目の表示条件に使われているため削除できません';
  end if;

  -- 将来の原価VersionなどのFK RESTRICTがある場合も、DBのFKで拒否する。
  delete from public.option_variant_choices vc
   where vc.id = p_choice_id and vc.group_id = v_group_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND: 対象の選択肢がありません';
  end if;
exception
  when lock_not_available or deadlock_detected then
    raise exception using errcode = 'P0001', message = v_busy;
end;
$$;

alter function public.delete_unused_variant_choice(uuid, uuid) owner to postgres;
revoke all on function public.delete_unused_variant_choice(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_unused_variant_choice(uuid, uuid) to authenticated;

create or replace function public.delete_unused_variant_group(
  p_option_id uuid, p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_option_code text;
  v_group_code text;
  v_busy constant text := 'LOCKED: ほかの保存処理と重なったため削除しませんでした';
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.can_edit_catalog() then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN: 商品編集権限がありません';
  end if;

  select o.code into v_option_code
    from public.options o
   where o.id = p_option_id and o.status = 'draft'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 下書き商品だけ削除できます';
  end if;

  perform public.assert_option_unreferenced(p_option_id, v_option_code);

  select vg.code into v_group_code
    from public.option_variant_groups vg
   where vg.id = p_group_id and vg.option_id = p_option_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND: 対象の選択項目がありません';
  end if;

  -- 子項目がこのgroup.codeを参照している場合、CASCADEで暗黙に表示条件を壊さない。
  if exists (
    select 1 from public.option_variant_groups child
     where child.option_id = p_option_id
       and child.id <> p_group_id
       and child.depends_on_group_code = v_group_code
  ) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 別の選択項目の表示条件に使われているため削除できません';
  end if;

  -- 既存FK ON DELETE CASCADEで配下選択肢を同じtransactionで削除。
  -- 原価Version等のFK RESTRICTで参照されている場合は全体がrollbackされる。
  delete from public.option_variant_groups vg
   where vg.id = p_group_id and vg.option_id = p_option_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND: 対象の選択項目がありません';
  end if;
exception
  when lock_not_available or deadlock_detected then
    raise exception using errcode = 'P0001', message = v_busy;
end;
$$;

alter function public.delete_unused_variant_group(uuid, uuid) owner to postgres;
revoke all on function public.delete_unused_variant_group(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_unused_variant_group(uuid, uuid) to authenticated;

-- 最終状態の権限・公開面をmigration内で確認。
do $postcondition$
begin
  if has_table_privilege('anon', 'public.option_variant_groups', 'DELETE')
     or has_table_privilege('authenticated', 'public.option_variant_groups', 'DELETE')
     or has_table_privilege('service_role', 'public.option_variant_groups', 'DELETE')
     or has_table_privilege('anon', 'public.option_variant_choices', 'DELETE')
     or has_table_privilege('authenticated', 'public.option_variant_choices', 'DELETE')
     or has_table_privilege('service_role', 'public.option_variant_choices', 'DELETE') then
    raise exception 'POSTCONDITION: variant direct DELETE must be unavailable to application roles';
  end if;

  if has_function_privilege('anon', 'public.delete_unused_variant_choice(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.delete_unused_variant_choice(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_unused_variant_choice(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_unused_variant_group(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.delete_unused_variant_group(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_unused_variant_group(uuid, uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: variant deletion RPC execution boundary is incorrect';
  end if;
end;
$postcondition$;
