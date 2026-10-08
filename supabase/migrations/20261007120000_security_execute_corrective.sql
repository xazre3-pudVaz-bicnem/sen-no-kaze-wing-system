-- Security corrective（2026-10-07）：API ロールへ公開する必要のない EXECUTE を閉じる。
--
-- Supabase では、postgres が public に作成した関数へ anon / authenticated / service_role の
-- EXECUTE が既定権限（pg_default_acl）で自動付与される。`revoke ... from public` だけでは
-- この付与は外れない。既存 migration を全て適用しても残る 4 関数を、ここで是正する。
--
--   duplicate_configuration      … 未ログインを明示的に拒否し、所有者判定を NULL 安全にする。
--                                   search_path を空にし、EXECUTE は authenticated だけにする
--   notify / write_audit         … SECURITY DEFINER のトリガー関数からのみ呼ぶ内部関数。API からは実行させない
--   validate_configuration_items … 保存・見積依頼の RPC 内部からのみ呼ぶ検証関数。API からは実行させない
--
-- 本体分類表の corrective（PR #389）とは責任範囲を分けた独立 corrective。
-- 既存 migration は編集しない。テーブル・データは変更しない。

begin;

-- ---------- preflight / fail closed ----------

do $$
begin
  if to_regprocedure('public.duplicate_configuration(uuid)') is null
     or to_regprocedure('public.notify(uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.write_audit(text,text,uuid,text,jsonb,jsonb)') is null
     or to_regprocedure('public.validate_configuration_items(uuid,uuid[])') is null
     or to_regprocedure('public.validate_configuration_items(uuid,uuid[],text)') is null
     or to_regprocedure('public.recalculate_configuration(uuid)') is null
  then
    raise exception 'PRECONDITION: target functions are missing; review migration order';
  end if;
end;
$$;

-- ---------- duplicate_configuration ----------
-- 20260830091000_exterior_four_faces の定義から、次の 3 点だけを変更する。
--   1. search_path を public から空へ（参照は全てスキーマ修飾済み）
--   2. 先頭で未ログイン（auth.uid() が NULL）を拒否
--   3. 所有者判定を coalesce(..., false) で fail closed にする（判定不能を許可に倒さない）

create or replace function public.duplicate_configuration(p_configuration_id uuid)
returns public.configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  src public.configurations;
  v_id uuid;
  v_model_slug text;
  v_effective_spec text;
  v_has_complete_independent_insulation boolean := false;
begin
  -- 未ログインは最初に拒否する
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select * into src from public.configurations where id = p_configuration_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- 判定不能を許可に倒さない（fail closed）
  if not coalesce(public.is_admin() or src.user_id = v_uid, false) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select
    b.slug,
    coalesce(nullif(src.spec_code, ''), b.presets -> 0 ->> 'code', '')
  into v_model_slug, v_effective_spec
  from public.base_models b
  where b.id = src.base_model_id;

  if v_model_slug = 'wing-01' then
    select count(distinct cat.code) = 3
      into v_has_complete_independent_insulation
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
    where ci.configuration_id = p_configuration_id
      and cat.code in ('insulation-floor', 'insulation-wall', 'insulation-ceiling');

    if exists (
      select 1
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
      where ci.configuration_id = p_configuration_id
        and o.code = 'insulation-upgrade-wing'
    ) then
      raise exception
        'VALIDATION: 旧有料断熱を含む仕様は自動複製できません。断熱内容を確認してください'
        using errcode = 'P0001';
    end if;

    if not v_has_complete_independent_insulation
       and v_effective_spec not in ('hotel', 'residence', 'office') then
      raise exception
        'VALIDATION: 複製元のWing仕様を判定できません。仕様を確認してから複製してください'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.configurations (
    user_id, base_model_id, name, preview_image_url, notes, finish_level, spec_code, exterior_faces
  ) values (
    src.user_id,
    src.base_model_id,
    src.name || '（コピー）',
    src.preview_image_url,
    src.notes,
    src.finish_level,
    case when v_model_slug = 'wing-01' then v_effective_spec else src.spec_code end,
    src.exterior_faces
  ) returning id into v_id;

  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;

  -- 旧正式履歴は変更せず、複製して新しく作るWing Draftだけを現行required条件へ補完する。
  -- すでに同じ独立断熱カテゴリーの商品がある場合は、その選択を尊重して標準品を追加しない。
  if v_model_slug = 'wing-01' and not v_has_complete_independent_insulation then
    with wanted(category_code, option_code) as (
      values
        ('insulation-floor'::text, 'insulation-floor-mirafoam-90'::text),
        (
          'insulation-wall'::text,
          case
            when v_effective_spec = 'hotel' then 'insulation-wall-styrofoam-90-hotel-base'
            else 'insulation-wall-glasswool-90-standard'
          end
        ),
        (
          'insulation-ceiling'::text,
          case
            when v_effective_spec = 'hotel' then 'insulation-ceiling-styrofoam-90-hotel-base'
            else 'insulation-ceiling-glasswool-90-standard'
          end
        )
    )
    insert into public.configuration_items (
      configuration_id,
      option_id,
      quantity,
      variant_choice_ids
    )
    select
      v_id,
      standard_option.id,
      1,
      '{}'::uuid[]
    from wanted w
    join public.options standard_option on standard_option.code = w.option_code
    where not exists (
      select 1
      from public.configuration_items ci
      join public.options existing_option on existing_option.id = ci.option_id
      join public.option_categories existing_category on existing_category.id = existing_option.category_id
      where ci.configuration_id = v_id
        and existing_category.code = w.category_code
    );
  end if;

  return public.recalculate_configuration(v_id);
end;
$$;

alter function public.duplicate_configuration(uuid) owner to postgres;
revoke execute on function public.duplicate_configuration(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.duplicate_configuration(uuid) to authenticated;

-- ---------- internal helpers ----------

revoke execute on function public.notify(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.notify(uuid, text, text, text, text, text) to service_role;

revoke execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb) to service_role;

revoke execute on function public.validate_configuration_items(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_configuration_items(uuid, uuid[], text)
  from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_duplicate constant regprocedure := 'public.duplicate_configuration(uuid)'::regprocedure;
  v_notify constant regprocedure := 'public.notify(uuid, text, text, text, text, text)'::regprocedure;
  v_audit constant regprocedure := 'public.write_audit(text, text, uuid, text, jsonb, jsonb)'::regprocedure;
  v_validate2 constant regprocedure := 'public.validate_configuration_items(uuid, uuid[])'::regprocedure;
  v_validate3 constant regprocedure := 'public.validate_configuration_items(uuid, uuid[], text)'::regprocedure;
  v_fn regprocedure;
begin
  -- API ロールに内部関数の EXECUTE が残っていないこと
  foreach v_fn in array array[v_notify, v_audit, v_validate2, v_validate3]
  loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'SECURITY_EXECUTE_CORRECTIVE: % is still executable by an API role', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  if has_function_privilege('anon', v_duplicate, 'execute')
     or has_function_privilege('service_role', v_duplicate, 'execute')
     or not has_function_privilege('authenticated', v_duplicate, 'execute') then
    raise exception 'SECURITY_EXECUTE_CORRECTIVE: duplicate_configuration must be executable by authenticated only'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_duplicate
       and (
         pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
         or not p.prosecdef
         or not ('search_path=""' = any(p.proconfig))
       )
  ) then
    raise exception 'SECURITY_EXECUTE_CORRECTIVE: duplicate_configuration must be a postgres-owned SECURITY DEFINER function with an empty search_path'
      using errcode = 'P0001';
  end if;

  -- 内部関数の呼び出し元は SECURITY DEFINER で、その所有者が実行できること
  -- （revoke 後も通知・監査・保存時の検証が止まらない保証）
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname not in ('notify', 'write_audit', 'validate_configuration_items')
       and (
         p.prosrc ~ '(^|[^_a-z])notify\s*\('
         or p.prosrc ~ '(^|[^_a-z])write_audit\s*\('
         or p.prosrc ~ '(^|[^_a-z])validate_configuration_items\s*\('
       )
       and (
         not p.prosecdef
         or not has_function_privilege(p.proowner, v_notify, 'execute')
         or not has_function_privilege(p.proowner, v_audit, 'execute')
         or not has_function_privilege(p.proowner, v_validate3, 'execute')
       )
  ) then
    raise exception 'SECURITY_EXECUTE_CORRECTIVE: a caller of an internal helper is not SECURITY DEFINER or would lose EXECUTE'
      using errcode = 'P0001';
  end if;
end;
$postcondition$;

commit;
