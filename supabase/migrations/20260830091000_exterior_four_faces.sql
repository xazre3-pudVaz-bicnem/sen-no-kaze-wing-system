-- =============================================================
-- 外壁を正面・右側面・背面・左側面ごとに保存する
-- 商品マスターは既存の options / option_variant_* を参照し、
-- 保存した仕様だけが4面の割当を持つ。
-- =============================================================

alter table public.configurations
  add column if not exists exterior_faces jsonb not null default '[]'::jsonb;

comment on column public.configurations.exterior_faces is
  '外壁4面の割当。[{face_code, option_id, variant_choice_ids}]。face_code=front/right/back/left';

alter table public.configurations
  drop constraint if exists configurations_exterior_faces_shape_check;
alter table public.configurations
  add constraint configurations_exterior_faces_shape_check
  check (
    jsonb_typeof(exterior_faces) = 'array'
    and jsonb_array_length(exterior_faces) <= 4
  );

-- APIを直接呼ばれても、4面以外の値・外壁以外の商品・別商品の色を保存させない。
create or replace function public.validate_configuration_exterior_faces()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_face text;
  v_option uuid;
  v_choice text;
  v_count integer;
begin
  if new.exterior_faces is null or new.exterior_faces = '[]'::jsonb then
    return new;
  end if;

  if jsonb_typeof(new.exterior_faces) <> 'array' or jsonb_array_length(new.exterior_faces) <> 4 then
    raise exception 'VALIDATION: 外壁は4面すべてを指定してください' using errcode = 'P0001';
  end if;

  select count(distinct value ->> 'face_code') into v_count
    from jsonb_array_elements(new.exterior_faces);
  if v_count <> 4 then
    raise exception 'VALIDATION: 外壁の面指定が重複しています' using errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(new.exterior_faces)
  loop
    v_face := r ->> 'face_code';
    if v_face not in ('front', 'right', 'back', 'left') then
      raise exception 'VALIDATION: 外壁の面指定が不正です' using errcode = 'P0001';
    end if;

    begin
      v_option := (r ->> 'option_id')::uuid;
    exception when others then
      raise exception 'VALIDATION: 外壁商品IDが不正です' using errcode = 'P0001';
    end;

    if not exists (
      select 1
        from public.options o
        join public.option_categories c on c.id = o.category_id
       where o.id = v_option
         and c.code = 'exterior-wall'
         and o.status = 'published'
         and (o.base_model_id is null or o.base_model_id = new.base_model_id)
    ) then
      raise exception 'VALIDATION: 外壁以外の商品は面指定に使用できません' using errcode = 'P0001';
    end if;

    if jsonb_typeof(coalesce(r -> 'variant_choice_ids', '[]'::jsonb)) <> 'array' then
      raise exception 'VALIDATION: 外壁の選択項目が不正です' using errcode = 'P0001';
    end if;

    for v_choice in select value from jsonb_array_elements_text(coalesce(r -> 'variant_choice_ids', '[]'::jsonb))
    loop
      if not exists (
        select 1
          from public.option_variant_choices vc
          join public.option_variant_groups vg on vg.id = vc.group_id
         where vc.id = v_choice::uuid
           and vg.option_id = v_option
           and vc.status = 'published'
           and vg.status = 'published'
      ) then
        raise exception 'VALIDATION: 外壁商品の選択項目が一致しません' using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  return new;
end $$;

revoke all on function public.validate_configuration_exterior_faces() from public;

drop trigger if exists configurations_exterior_faces_validate on public.configurations;
create trigger configurations_exterior_faces_validate
before insert or update of exterior_faces, base_model_id on public.configurations
for each row execute function public.validate_configuration_exterior_faces();

-- 複製時にも、注文範囲・仕様・商品バリエーション・外壁4面を引き継ぐ。
create or replace function public.duplicate_configuration(p_configuration_id uuid)
returns public.configurations language plpgsql security definer set search_path = public as $$
declare
  src public.configurations;
  v_id uuid;
begin
  select * into src from public.configurations where id = p_configuration_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or src.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
    src.spec_code,
    src.exterior_faces
  ) returning id into v_id;

  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;

  return public.recalculate_configuration(v_id);
end $$;

revoke all on function public.duplicate_configuration(uuid) from public;
grant execute on function public.duplicate_configuration(uuid) to authenticated;
