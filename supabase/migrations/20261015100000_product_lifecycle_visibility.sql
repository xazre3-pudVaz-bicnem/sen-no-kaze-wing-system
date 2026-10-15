-- 商品台帳の「登録済み」と、お客様シミュレーター表示・取扱終了を分離する。
-- 既存商品は現在の挙動を維持するため、simulator_visible=true / archived_at=null で開始する。

alter table public.options
  add column if not exists simulator_visible boolean not null default true;

alter table public.options
  add column if not exists archived_at timestamptz;

comment on column public.options.simulator_visible is
  '登録済み・取扱中の商品をお客様シミュレーターの新規選択肢へ表示するか。見積での選択可否とは別。';

comment on column public.options.archived_at is
  '取扱終了日時。NULLは取扱中。履歴保持のため商品行は削除せず、取扱再開時はNULLへ戻す。';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'options_archived_requires_published_chk'
      and conrelid = 'public.options'::regclass
  ) then
    alter table public.options
      add constraint options_archived_requires_published_chk
      check (archived_at is null or status = 'published');
  end if;
end
$$;

-- UIを迂回して商品IDを送っても、取扱終了・シミュレーター非表示の商品を
-- 新しいお客様Configurationへ保存できないようDB側でも保証する。
-- 既存non-draft履歴は書き換えず、Draftの新規明細追加・差替えだけを対象にする。
create or replace function public.enforce_configuration_option_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_configuration_status text;
  v_option_status text;
  v_simulator_visible boolean;
  v_archived_at timestamptz;
begin
  select cfg.status, o.status, o.simulator_visible, o.archived_at
    into v_configuration_status, v_option_status, v_simulator_visible, v_archived_at
    from public.configurations cfg
    join public.options o on o.id = new.option_id
   where cfg.id = new.configuration_id;

  if not found then
    raise exception 'VALIDATION: Configurationまたは商品を確認できません'
      using errcode = 'P0001';
  end if;

  if v_configuration_status = 'draft'
     and (
       v_option_status <> 'published'
       or not coalesce(v_simulator_visible, true)
       or v_archived_at is not null
     ) then
    raise exception 'VALIDATION: この商品は現在シミュレーターで選択できません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists configuration_items_option_lifecycle_guard on public.configuration_items;
create trigger configuration_items_option_lifecycle_guard
before insert or update of configuration_id, option_id on public.configuration_items
for each row
execute function public.enforce_configuration_option_lifecycle();

-- 外壁4面はconfiguration_itemsではなくconfigurations.exterior_facesにも商品IDを保持するため、
-- 同じライフサイクル条件を別途保証する。
create or replace function public.enforce_configuration_exterior_face_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'draft'
     and exists (
       select 1
         from jsonb_array_elements(
           case
             when jsonb_typeof(coalesce(new.exterior_faces, '[]'::jsonb)) = 'array'
               then coalesce(new.exterior_faces, '[]'::jsonb)
             else '[]'::jsonb
           end
         ) face(value)
         left join public.options o
           on o.id = case
             when jsonb_typeof(face.value) = 'object'
              and (face.value ->> 'option_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             then (face.value ->> 'option_id')::uuid
             else null
           end
        where face.value ? 'option_id'
          and (
            o.id is null
            or o.status <> 'published'
            or not coalesce(o.simulator_visible, true)
            or o.archived_at is not null
          )
     ) then
    raise exception 'VALIDATION: 外壁に現在シミュレーターで選択できない商品が含まれています'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists configurations_exterior_face_lifecycle_guard on public.configurations;
create trigger configurations_exterior_face_lifecycle_guard
before insert or update of exterior_faces on public.configurations
for each row
execute function public.enforce_configuration_exterior_face_lifecycle();

-- 商品を取扱終了/非表示にした後も、既存Draftの保存値は履歴候補として残す。
-- ただしDraftのまま再保存せず見積依頼等へ進める抜け道は塞ぐ。
create or replace function public.enforce_configuration_lifecycle_on_submit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status <> 'draft' then
    if exists (
      select 1
        from public.configuration_items ci
        left join public.options o on o.id = ci.option_id
       where ci.configuration_id = new.id
         and (
           o.id is null
           or o.status <> 'published'
           or not coalesce(o.simulator_visible, true)
           or o.archived_at is not null
         )
    ) then
      raise exception 'VALIDATION: 現在シミュレーターで選択できない商品が含まれています。内容を更新してから進めてください'
        using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(coalesce(new.exterior_faces, '[]'::jsonb)) = 'array'
              then coalesce(new.exterior_faces, '[]'::jsonb)
            else '[]'::jsonb
          end
        ) face(value)
        left join public.options o
          on o.id = case
            when jsonb_typeof(face.value) = 'object'
             and (face.value ->> 'option_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (face.value ->> 'option_id')::uuid
            else null
          end
       where face.value ? 'option_id'
         and (
           o.id is null
           or o.status <> 'published'
           or not coalesce(o.simulator_visible, true)
           or o.archived_at is not null
         )
    ) then
      raise exception 'VALIDATION: 外壁に現在シミュレーターで選択できない商品が含まれています。内容を更新してから進めてください'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists configurations_lifecycle_submit_guard on public.configurations;
create trigger configurations_lifecycle_submit_guard
before update of status on public.configurations
for each row
execute function public.enforce_configuration_lifecycle_on_submit();

-- trigger関数は直接呼ばせない。trigger自体は関数所有者権限で実行される。
revoke all on function public.enforce_configuration_option_lifecycle() from public, anon, authenticated;
revoke all on function public.enforce_configuration_exterior_face_lifecycle() from public, anon, authenticated;
revoke all on function public.enforce_configuration_lifecycle_on_submit() from public, anon, authenticated;
