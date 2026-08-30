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
