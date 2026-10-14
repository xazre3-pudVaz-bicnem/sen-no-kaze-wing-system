-- PR #482 hardening: keep option code references stable and serialize safe-delete
-- in the same lock order as existing Configuration save / catalog import writers.

create or replace function public.prevent_option_code_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'VALIDATION: 商品codeは登録後に変更できません' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter function public.prevent_option_code_update() owner to postgres;
revoke all on function public.prevent_option_code_update() from public, anon, authenticated, service_role;

drop trigger if exists options_code_immutable on public.options;
create trigger options_code_immutable
before update of code on public.options
for each row execute function public.prevent_option_code_update();

-- The first safe-delete RPC remains as an internal implementation only.
-- It contains the complete reference checks; authenticated callers must use
-- the serialized wrapper below so that normal writers cannot deadlock against it.
revoke all on function public.delete_unused_published_option(uuid) from public, anon, authenticated, service_role;

create or replace function public.delete_unused_published_option_serialized(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '2s'
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_edit_catalog() then
    raise exception using message = 'FORBIDDEN: 登録済み商品を削除できるのは商品マスター編集権限を持つ担当者だけです';
  end if;

  -- Canonical order starts with the target option row. apply_catalog_import()
  -- writes options before variant tables, so safe-delete must never hold a
  -- variant table lock while waiting for this row.
  perform 1
  from public.options o
  where o.id = p_option_id
  for update;

  if not found then
    raise exception using message = 'NOT_FOUND: 商品が見つかりません';
  end if;

  -- Match save_configuration_atomic(): configurations -> configuration_items
  -- -> configuration_snapshots. Separate LOCK statements make the acquisition
  -- order explicit and keep the writer side able to complete before safe-delete.
  lock table public.base_models in share mode;
  lock table public.configurations in share mode;
  lock table public.configuration_items in share mode;
  lock table public.configuration_snapshots in share mode;
  lock table public.estimate_templates in share mode;
  lock table public.legacy_migration_financial_snapshots in share mode;
  lock table public.option_variant_groups in share mode;
  lock table public.option_variant_choices in share mode;
  lock table public.quote_internal_snapshots in share mode;

  -- Preset references use option.code rather than a UUID FK. The immutable-code
  -- trigger prevents new drift; this precondition also stops deletion if legacy
  -- or out-of-band data is already dangling.
  if exists (
    select 1
    from public.base_models bm
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end
    ) preset(value)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(preset.value) = 'object'
         and preset.value ? 'option_codes'
         and jsonb_typeof(preset.value -> 'option_codes') = 'array'
          then preset.value -> 'option_codes'
        else '[]'::jsonb
      end
    ) preset_option(code)
    left join public.options o on o.code = preset_option.code
    where o.id is null
  ) then
    raise exception using message = 'VALIDATION: 本体Presetに存在しない商品codeが含まれています。安全確認ができないため削除を停止しました。';
  end if;

  -- The internal implementation re-acquires locks already held by this
  -- transaction, then performs the full reference checks and DELETE atomically.
  perform public.delete_unused_published_option(p_option_id);
end;
$$;

alter function public.delete_unused_published_option_serialized(uuid) owner to postgres;
revoke all on function public.delete_unused_published_option_serialized(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_unused_published_option_serialized(uuid) to authenticated;
