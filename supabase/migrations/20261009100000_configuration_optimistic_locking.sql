-- Configuration 保存の同時編集対策（optimistic locking）。
--
-- 確定方針（2026-10-07）: Configuration 保存の last-write-wins は正式仕様として許容しない。
-- 2 つの画面で同じプランを開き、古い画面から後で保存しても、先の保存内容を黙って上書きしない。
--
--   * configurations.lock_version（整数、初期値 1）を追加する。既存行は 1 になる（意味のある既存値は書き換えない）
--   * save_configuration_atomic に p_expected_lock_version を追加する
--       - 新規保存（p_configuration_id が NULL）: 版の指定は不要。lock_version = 1 で作成
--       - 既存 Draft の保存: 読み込んだ時点の lock_version と一致しなければ拒否（NULL も拒否）。成功したら +1
--   * 判定は、既存の「行を FOR UPDATE で lock → Draft 判定」の直後に置く。同時に届いた保存は行 lock で直列化され、
--     後から来た保存は更新後の版を読むため、必ずどちらか一方だけが成功する
--
-- save_configuration_atomic の本体は 20260928100000 の定義から、上記の 3 箇所だけを変更している
-- （引数の追加・版の判定・版の加算。テストで元定義と照合する）。
-- 引数が増えるため、旧 13 引数の関数を削除して作り直す。owner と EXECUTE は同じ内容で付け直す。
-- 発行済み Quote / Revision / Snapshot と、既存 Configuration の内容・金額は変更しない。

begin;

-- ---------- preflight / fail closed ----------

do $$
begin
  if to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean)') is null then
    raise exception 'PRECONDITION: save_configuration_atomic (13 arguments) is missing; review migration order';
  end if;
  if to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer)') is not null then
    raise exception 'PRECONDITION: save_configuration_atomic with lock version already exists';
  end if;
end;
$$;

-- ---------- lock_version ----------

alter table public.configurations
  add column if not exists lock_version integer not null default 1;

alter table public.configurations
  drop constraint if exists configurations_lock_version_check;
alter table public.configurations
  add constraint configurations_lock_version_check check (lock_version >= 1);

comment on column public.configurations.lock_version is
  '同時編集の検知用の版。save_configuration_atomic が既存 Draft を保存するたびに 1 増える。保存時は読み込んだ時点の値を p_expected_lock_version で渡す。';

-- ---------- save RPC ----------

drop function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean);

create function public.save_configuration_atomic(
  p_configuration_id uuid,
  p_base_model_id uuid,
  p_name text,
  p_option_ids uuid[],
  p_preview_image_url text,
  p_notes text,
  p_finish_level text default 'full',
  p_variant_choice_ids uuid[] default '{}',
  p_spec_code text default null,
  p_exterior_faces jsonb default '[]'::jsonb,
  p_site_prefecture text default null,
  p_site_municipality text default null,
  p_site_location_undecided boolean default false,
  p_expected_lock_version integer default null
)
returns public.configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_configuration_id;
  v_uid uuid := auth.uid();
  v_cfg public.configurations;
  v_options uuid[] := coalesce(p_option_ids, '{}'::uuid[]);
  v_variants uuid[] := coalesce(p_variant_choice_ids, '{}'::uuid[]);
  v_level text := coalesce(nullif(p_finish_level, ''), 'full');
  v_face jsonb;
  v_face_option_id uuid;
  v_face_variants uuid[];
  v_face_codes text[];
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_id is not null then
    select * into v_cfg from public.configurations where id = v_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if v_cfg.user_id <> v_uid and not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if v_cfg.status <> 'draft' then
      raise exception 'LOCKED: Draft以外の仕様は通常保存できません。複製して編集してください。' using errcode = 'P0001';
    end if;
    -- 同時編集の検知（optimistic locking）。読み込んだ時点の版と一致しない保存は拒否し、後勝ちにしない。
    -- 行は上で FOR UPDATE 済みなので、同時に届いた保存は直列化され、後から来た方がここで止まる。
    -- 版の指定が無い（NULL）保存も拒否する。
    if v_cfg.lock_version is distinct from p_expected_lock_version then
      raise exception 'LOCKED: 他の画面でこのプランが更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
    end if;
  end if;
  if v_level not in ('shell', 'equipment', 'full') then
    raise exception 'VALIDATION: 注文範囲の指定が不正です' using errcode = 'P0001';
  end if;
  if p_site_location_undecided and (p_site_prefecture is not null or p_site_municipality is not null) then
    raise exception 'VALIDATION: 設置予定地を未定にする場合、都道府県・市区町村は指定できません' using errcode = 'P0001';
  end if;
  if p_site_municipality is not null and p_site_prefecture is null then
    raise exception 'VALIDATION: 市区町村を指定する場合、都道府県も指定してください' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.base_models m
     where m.id = p_base_model_id and m.status = 'published'
  ) then
    raise exception 'VALIDATION: 公開中のモデルではありません' using errcode = 'P0001';
  end if;
  -- Keep the DB allow-list aligned with simulatorEstimateChoices(): base is
  -- universal; model presets and same-model estimate templates are valid.
  if p_spec_code is not null
     and p_spec_code <> 'base'
     and not exists (
       select 1
         from public.base_models m
         cross join lateral jsonb_array_elements(coalesce(m.presets, '[]'::jsonb)) preset
        where m.id = p_base_model_id and preset ->> 'code' = p_spec_code
     )
     and not exists (
       select 1
         from public.estimate_templates t
        where t.base_model_id = p_base_model_id
          and t.spec_code = p_spec_code
     ) then
    raise exception 'VALIDATION: このモデルでは指定された仕様を選べません' using errcode = 'P0001';
  end if;
  if cardinality(v_options) <> cardinality(array(select distinct unnest(v_options))) then
    raise exception 'VALIDATION: 同じオプションを複数回保存できません' using errcode = 'P0001';
  end if;
  if cardinality(v_variants) <> cardinality(array(select distinct unnest(v_variants))) then
    raise exception 'VALIDATION: 同じバリエーションを複数回保存できません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from unnest(v_options) input(option_id)
      left join public.options o on o.id = input.option_id
      left join public.option_categories c on c.id = o.category_id
     where o.id is null
        or o.status <> 'published'
        or (o.base_model_id is not null and o.base_model_id <> p_base_model_id)
        or public.finish_level_rank(c.finish_level) > public.finish_level_rank(v_level)
        or (p_spec_code is not null and cardinality(o.spec_codes) > 0 and not (p_spec_code = any(o.spec_codes)))
  ) then
    raise exception 'VALIDATION: 選択できないオプションが含まれています' using errcode = 'P0001';
  end if;
  perform public.validate_configuration_items(p_base_model_id, v_options, v_level);

  if exists (
    select 1
      from unnest(v_variants) input(choice_id)
      left join public.option_variant_choices vc on vc.id = input.choice_id
      left join public.option_variant_groups vg on vg.id = vc.group_id
     where vc.id is null
        or vc.status <> 'published'
        or vg.status <> 'published'
        or not (vg.option_id = any(v_options))
  ) then
    raise exception 'VALIDATION: 選択できないバリエーションが含まれています' using errcode = 'P0001';
  end if;
  -- Mirror pruneHiddenVariantChoices(): a group is hidden only when its
  -- configured dependency group exists and none of its allowed choices is
  -- selected.  Hidden choices, including price-bearing choices, are never
  -- accepted by the RPC.
  if exists (
    select 1
      from unnest(v_variants) input(choice_id)
      join public.option_variant_choices vc on vc.id = input.choice_id
      join public.option_variant_groups vg on vg.id = vc.group_id
     where vg.depends_on_group_code is not null
       and cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
       and exists (
         select 1
           from public.option_variant_groups dependency_group
          where dependency_group.option_id = vg.option_id
            and dependency_group.code = vg.depends_on_group_code
            and dependency_group.status = 'published'
       )
       and not exists (
         select 1
           from public.option_variant_choices dependency_choice
           join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
          where dependency_choice.id = any(v_variants)
            and dependency_group.option_id = vg.option_id
            and dependency_group.code = vg.depends_on_group_code
            and dependency_group.status = 'published'
            and dependency_choice.code = any(vg.depends_on_choice_codes)
       )
  ) then
    raise exception 'VALIDATION: 非表示のバリエーションは保存できません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.option_variant_choices vc
      join public.option_variant_groups vg on vg.id = vc.group_id
     where vc.id = any(v_variants)
     group by vg.id
    having count(*) > 1
  ) then
    raise exception 'VALIDATION: 同じ選択項目から複数のバリエーションは選べません' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.option_variant_groups vg
     where vg.option_id = any(v_options)
       and vg.status = 'published'
       and vg.is_required
       and (
         vg.depends_on_group_code is null
         or cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
         or not exists (
           select 1
             from public.option_variant_groups dependency_group
            where dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
         )
         or exists (
           select 1
             from public.option_variant_choices dependency_choice
             join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
            where dependency_choice.id = any(v_variants)
              and dependency_group.option_id = vg.option_id
              and dependency_group.code = vg.depends_on_group_code
              and dependency_group.status = 'published'
              and dependency_choice.code = any(vg.depends_on_choice_codes)
         )
       )
       and not exists (
         select 1 from public.option_variant_choices selected_choice
          where selected_choice.id = any(v_variants) and selected_choice.group_id = vg.id
       )
  ) then
    raise exception 'REQUIRED: 必須のバリエーションを選択してください' using errcode = 'P0001';
  end if;

  if p_exterior_faces is null or jsonb_typeof(p_exterior_faces) <> 'array' then
    raise exception 'VALIDATION: 外壁4面の形式が不正です' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_exterior_faces) not in (0, 4) then
    raise exception 'VALIDATION: 外壁は4面すべてを指定してください' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_exterior_faces) = 0 then
    -- [] is a read/unchanged compatibility state for legacy configurations;
    -- it cannot create a new exterior selection or undo an existing 4-face one.
    if v_id is null and exists (
      select 1
        from unnest(v_options) input(option_id)
        join public.options o on o.id = input.option_id
        join public.option_categories c on c.id = o.category_id
       where c.code = 'exterior-wall'
    ) then
      raise exception 'VALIDATION: 新規Configurationの外壁は4面すべてを指定してください' using errcode = 'P0001';
    end if;
    if v_id is not null and jsonb_array_length(coalesce(v_cfg.exterior_faces, '[]'::jsonb)) = 4 then
      raise exception 'VALIDATION: 4面化済みConfigurationを旧外壁方式へ戻すことはできません' using errcode = 'P0001';
    end if;
    if v_id is not null and coalesce(v_cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb
       and (
         exists (
           select 1
             from public.configuration_items ci
             join public.options o on o.id = ci.option_id
             join public.option_categories c on c.id = o.category_id
            where ci.configuration_id = v_id
              and c.code = 'exterior-wall'
              and not exists (
                select 1
                  from unnest(v_options) input(option_id)
                 where input.option_id = ci.option_id
                   and coalesce(array(
                     select vc.id
                       from public.option_variant_choices vc
                       join public.option_variant_groups vg on vg.id = vc.group_id
                      where vc.id = any(v_variants)
                        and vg.option_id = ci.option_id
                      order by vc.id
                   ), '{}'::uuid[]) = coalesce(array(
                     select distinct legacy_choice_id
                       from unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) legacy_choice_id
                      order by legacy_choice_id
                   ), '{}'::uuid[])
              )
         )
         or exists (
           select 1
             from unnest(v_options) input(option_id)
             join public.options o on o.id = input.option_id
             join public.option_categories c on c.id = o.category_id
            where c.code = 'exterior-wall'
              and not exists (
                select 1
                  from public.configuration_items ci
                 where ci.configuration_id = v_id
                   and ci.option_id = input.option_id
                   and coalesce(array(
                     select vc.id
                       from public.option_variant_choices vc
                       join public.option_variant_groups vg on vg.id = vc.group_id
                      where vc.id = any(v_variants)
                        and vg.option_id = input.option_id
                      order by vc.id
                   ), '{}'::uuid[]) = coalesce(array(
                     select distinct legacy_choice_id
                       from unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) legacy_choice_id
                      order by legacy_choice_id
                   ), '{}'::uuid[])
              )
         )
       ) then
      raise exception 'VALIDATION: legacy外壁を変更する場合は4面すべてを指定してください' using errcode = 'P0001';
    end if;
  end if;
  if jsonb_array_length(p_exterior_faces) = 4 then
    select array_agg(face ->> 'face_code') into v_face_codes
      from jsonb_array_elements(p_exterior_faces) face;
    if cardinality(v_face_codes) <> 4
       or cardinality(array(select distinct unnest(v_face_codes))) <> 4
       or not (v_face_codes @> array['front', 'right', 'back', 'left']) then
      raise exception 'VALIDATION: 外壁は正面・右側面・背面・左側面を各1面指定してください' using errcode = 'P0001';
    end if;
    for v_face in select value from jsonb_array_elements(p_exterior_faces)
    loop
      if jsonb_typeof(v_face) <> 'object'
         or jsonb_typeof(v_face -> 'option_id') <> 'string'
         or (v_face ->> 'option_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or jsonb_typeof(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb)) <> 'array'
      then
        raise exception 'VALIDATION: 外壁の指定が不正です' using errcode = 'P0001';
      end if;
      v_face_option_id := (v_face ->> 'option_id')::uuid;
      if exists (
        select 1 from jsonb_array_elements_text(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb)) choice(value)
         where choice.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ) then
        raise exception 'VALIDATION: 外壁のバリエーション指定が不正です' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_face_variants
        from jsonb_array_elements_text(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb));
      if not exists (
        select 1
          from public.options o
          join public.option_categories c on c.id = o.category_id
         where o.id = v_face_option_id
           and o.status = 'published'
           and c.code = 'exterior-wall'
           and (o.base_model_id is null or o.base_model_id = p_base_model_id)
           and (p_spec_code is null or cardinality(o.spec_codes) = 0 or p_spec_code = any(o.spec_codes))
      ) then
        raise exception 'VALIDATION: 外壁の商品指定が不正です' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from unnest(v_face_variants) input(choice_id)
          left join public.option_variant_choices vc on vc.id = input.choice_id
          left join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id is null or vc.status <> 'published' or vg.status <> 'published' or vg.option_id <> v_face_option_id
      ) then
        raise exception 'VALIDATION: 外壁のバリエーション指定が不正です' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from unnest(v_face_variants) input(choice_id)
          join public.option_variant_choices vc on vc.id = input.choice_id
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vg.depends_on_group_code is not null
           and cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) > 0
           and exists (
             select 1
               from public.option_variant_groups dependency_group
              where dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
           )
           and not exists (
             select 1
               from public.option_variant_choices dependency_choice
               join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
              where dependency_choice.id = any(v_face_variants)
                and dependency_group.option_id = vg.option_id
                and dependency_group.code = vg.depends_on_group_code
                and dependency_group.status = 'published'
                and dependency_choice.code = any(vg.depends_on_choice_codes)
           )
      ) then
        raise exception 'VALIDATION: 非表示の外壁バリエーションは保存できません' using errcode = 'P0001';
      end if;
      if cardinality(v_face_variants) <> cardinality(array(select distinct unnest(v_face_variants))) then
        raise exception 'VALIDATION: 外壁のバリエーションが重複しています' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from public.option_variant_choices vc
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id = any(v_face_variants)
         group by vg.id having count(*) > 1
      ) then
        raise exception 'VALIDATION: 外壁で同じ選択項目から複数のバリエーションは選べません' using errcode = 'P0001';
      end if;
      if exists (
        select 1
          from public.option_variant_groups vg
         where vg.option_id = v_face_option_id
           and vg.status = 'published'
           and vg.is_required
           and (
             vg.depends_on_group_code is null
             or cardinality(coalesce(vg.depends_on_choice_codes, '{}'::text[])) = 0
             or not exists (
               select 1
                 from public.option_variant_groups dependency_group
                where dependency_group.option_id = vg.option_id
                  and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published'
             )
             or exists (
               select 1
                 from public.option_variant_choices dependency_choice
                 join public.option_variant_groups dependency_group on dependency_group.id = dependency_choice.group_id
                where dependency_choice.id = any(v_face_variants)
                  and dependency_group.option_id = vg.option_id
                  and dependency_group.code = vg.depends_on_group_code
                  and dependency_group.status = 'published'
                  and dependency_choice.code = any(vg.depends_on_choice_codes)
             )
           )
           and not exists (
             select 1 from public.option_variant_choices selected_choice
              where selected_choice.id = any(v_face_variants) and selected_choice.group_id = vg.id
           )
      ) then
        raise exception 'REQUIRED: 外壁の必須バリエーションを選択してください' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  if v_id is null then
    insert into public.configurations (
      user_id, base_model_id, name, preview_image_url, notes, finish_level, spec_code,
      exterior_faces, site_prefecture, site_municipality, site_location_undecided
    ) values (
      v_uid, p_base_model_id, coalesce(nullif(p_name, ''), '無題の仕様'), p_preview_image_url, p_notes, v_level, p_spec_code,
      p_exterior_faces, case when p_site_location_undecided then null else p_site_prefecture end,
      case when p_site_location_undecided then null else p_site_municipality end, p_site_location_undecided
    ) returning id into v_id;
  else
    update public.configurations
       set name = coalesce(nullif(p_name, ''), name), base_model_id = p_base_model_id,
           preview_image_url = p_preview_image_url, notes = p_notes, finish_level = v_level,
           spec_code = p_spec_code, exterior_faces = p_exterior_faces,
           site_prefecture = case when p_site_location_undecided then null else p_site_prefecture end,
           site_municipality = case when p_site_location_undecided then null else p_site_municipality end,
           site_location_undecided = p_site_location_undecided,
           lock_version = lock_version + 1
     where id = v_id;
    delete from public.configuration_items where configuration_id = v_id;
  end if;

  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, option_id, 1,
    coalesce((
      select array_agg(vc.id)
        from public.option_variant_choices vc
        join public.option_variant_groups vg on vg.id = vc.group_id
       where vc.id = any(v_variants) and vg.option_id = option_id
    ), '{}'::uuid[])
    from unnest(v_options) input(option_id);

  v_cfg := public.recalculate_configuration(v_id);
  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (v_id, 'saved', public.configuration_pricing_json(v_id));
  return v_cfg;
end;
$$;

alter function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer) owner to postgres;

revoke execute on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer) to authenticated;

-- 保存は RPC だけで行う（20260928100000 で authenticated から外した直接書き込みを、anon にもそろえる）。
-- lock_version を API ロールが直接進められないようにする。RLS でも拒否されるが、権限でも閉じる。
revoke insert, update on public.configurations from anon;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn constant regprocedure := 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer)'::regprocedure;
begin
  if (select count(*) from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_configuration_atomic') <> 1 then
    raise exception 'POSTCONDITION: exactly one save_configuration_atomic must exist (no last-write-wins overload)';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid = v_fn
       and (
         pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
         or not p.prosecdef
         or not ('search_path=""' = any(p.proconfig))
       )
  ) then
    raise exception 'POSTCONDITION: save_configuration_atomic must be a postgres-owned SECURITY DEFINER function with an empty search_path';
  end if;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'POSTCONDITION: save_configuration_atomic must be executable by authenticated only';
  end if;

  -- 版は RPC だけが進める。API ロールが直接書き換えられないこと
  if has_table_privilege('authenticated', 'public.configurations', 'UPDATE')
     or has_table_privilege('anon', 'public.configurations', 'UPDATE')
     or has_column_privilege('authenticated', 'public.configurations', 'lock_version', 'UPDATE')
     or has_column_privilege('anon', 'public.configurations', 'lock_version', 'UPDATE') then
    raise exception 'POSTCONDITION: API roles must not be able to update configurations.lock_version directly';
  end if;

  if exists (select 1 from public.configurations where lock_version is null or lock_version < 1) then
    raise exception 'POSTCONDITION: every configuration must have lock_version >= 1';
  end if;
end;
$postcondition$;

commit;
