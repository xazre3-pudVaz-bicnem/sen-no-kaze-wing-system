-- =============================================================
-- 商品マスター一括登録を 1 transaction で適用する。
-- PostgreSQL 関数は例外時に呼び出し全体が rollback されるため、
-- 商品だけ更新されて選択項目が残らない、といった部分反映を防ぐ。
-- =============================================================

create or replace function public.apply_catalog_import(
  p_options jsonb,
  p_variant_groups jsonb,
  p_variant_choices jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_code text;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) <> 'array'
     or jsonb_typeof(p_variant_groups) <> 'array'
     or jsonb_typeof(p_variant_choices) <> 'array' then
    raise exception 'IMPORT_VALIDATION: 一括登録データの形式が正しくありません';
  end if;

  for r in select value from jsonb_array_elements(p_options)
  loop
    v_code := r ->> 'code';
    begin
      insert into public.options (
        id, base_model_id, category_id, code, name, description, price, image_url,
        selection_type, is_required, is_default, is_installation, price_on_request,
        preview_key, affects_views, sort_order, status, spec_codes, owner_id,
        manufacturer, model_no, size_note, list_price, highlight
      ) values (
        (r ->> 'id')::uuid,
        nullif(r ->> 'base_model_id', '')::uuid,
        (r ->> 'category_id')::uuid,
        v_code,
        r ->> 'name',
        r ->> 'description',
        coalesce((r ->> 'price')::integer, 0),
        r ->> 'image_url',
        coalesce(r ->> 'selection_type', 'checkbox'),
        coalesce((r ->> 'is_required')::boolean, false),
        coalesce((r ->> 'is_default')::boolean, false),
        coalesce((r ->> 'is_installation')::boolean, false),
        coalesce((r ->> 'price_on_request')::boolean, false),
        r ->> 'preview_key',
        coalesce(array(select jsonb_array_elements_text(r -> 'affects_views')), '{}'::text[]),
        coalesce((r ->> 'sort_order')::integer, 0),
        coalesce(r ->> 'status', 'published'),
        coalesce(array(select jsonb_array_elements_text(r -> 'spec_codes')), '{}'::text[]),
        nullif(r ->> 'owner_id', '')::uuid,
        r ->> 'manufacturer',
        r ->> 'model_no',
        r ->> 'size_note',
        nullif(r ->> 'list_price', '')::integer,
        r ->> 'highlight'
      )
      on conflict (code) do update set
        base_model_id = excluded.base_model_id,
        category_id = excluded.category_id,
        name = excluded.name,
        description = excluded.description,
        price = excluded.price,
        image_url = excluded.image_url,
        selection_type = excluded.selection_type,
        is_required = excluded.is_required,
        is_default = excluded.is_default,
        is_installation = excluded.is_installation,
        price_on_request = excluded.price_on_request,
        preview_key = excluded.preview_key,
        affects_views = excluded.affects_views,
        sort_order = excluded.sort_order,
        status = excluded.status,
        spec_codes = excluded.spec_codes,
        owner_id = excluded.owner_id,
        manufacturer = excluded.manufacturer,
        model_no = excluded.model_no,
        size_note = excluded.size_note,
        list_price = excluded.list_price,
        highlight = excluded.highlight,
        updated_at = now();
    exception when others then
      raise exception 'IMPORT_OPTION % %: %', coalesce(r ->> 'import_operation', 'UPSERT'), coalesce(v_code, '(codeなし)'), sqlerrm;
    end;
  end loop;

  for r in select value from jsonb_array_elements(p_variant_groups)
  loop
    v_code := r ->> 'code';
    begin
      insert into public.option_variant_groups (
        id, option_id, code, name, note, sort_order, is_required, status
      ) values (
        (r ->> 'id')::uuid,
        (r ->> 'option_id')::uuid,
        v_code,
        r ->> 'name',
        r ->> 'note',
        coalesce((r ->> 'sort_order')::integer, 0),
        coalesce((r ->> 'is_required')::boolean, true),
        coalesce(r ->> 'status', 'published')
      )
      on conflict (id) do update set
        option_id = excluded.option_id,
        code = excluded.code,
        name = excluded.name,
        note = excluded.note,
        sort_order = excluded.sort_order,
        is_required = excluded.is_required,
        status = excluded.status,
        updated_at = now();
    exception when others then
      raise exception 'IMPORT_VARIANT_GROUP UPSERT %: %', coalesce(v_code, '(codeなし)'), sqlerrm;
    end;
  end loop;

  for r in select value from jsonb_array_elements(p_variant_choices)
  loop
    v_code := r ->> 'code';
    begin
      insert into public.option_variant_choices (
        id, group_id, code, name, kind, extra_price, price_on_request,
        image_url, note, sort_order, status
      ) values (
        (r ->> 'id')::uuid,
        (r ->> 'group_id')::uuid,
        v_code,
        r ->> 'name',
        coalesce(r ->> 'kind', 'option'),
        coalesce((r ->> 'extra_price')::integer, 0),
        coalesce((r ->> 'price_on_request')::boolean, false),
        r ->> 'image_url',
        r ->> 'note',
        coalesce((r ->> 'sort_order')::integer, 0),
        coalesce(r ->> 'status', 'published')
      )
      on conflict (id) do update set
        group_id = excluded.group_id,
        code = excluded.code,
        name = excluded.name,
        kind = excluded.kind,
        extra_price = excluded.extra_price,
        price_on_request = excluded.price_on_request,
        image_url = excluded.image_url,
        note = excluded.note,
        sort_order = excluded.sort_order,
        status = excluded.status,
        updated_at = now();
    exception when others then
      raise exception 'IMPORT_VARIANT_CHOICE UPSERT %: %', coalesce(v_code, '(codeなし)'), sqlerrm;
    end;
  end loop;
end;
$$;

revoke all on function public.apply_catalog_import(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_catalog_import(jsonb, jsonb, jsonb) to authenticated, service_role;
