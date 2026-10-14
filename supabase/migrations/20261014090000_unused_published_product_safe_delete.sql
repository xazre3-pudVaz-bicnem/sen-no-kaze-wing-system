-- 登録済み商品は、見積・仕様・履歴・標準見積・商品ルール等で一度も使われていない場合だけ削除できる。
-- 下書き商品の既存削除フローは維持し、通常のauthenticated RLS経由ではpublishedを直接DELETEできないようにする。
-- UUID/FKで表現されていない参照は、保存時のDB検証とsafe-delete中のtable lockを組み合わせ、
-- DELETE直後に待機中の書込みがdangling参照を復活させるraceもfail-closedにする。

create or replace function public.validate_base_model_preset_option_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preset jsonb;
  v_code text;
begin
  if jsonb_typeof(new.presets) <> 'array' then
    raise exception using message = 'VALIDATION: 本体Presetの商品参照形式が不正です';
  end if;

  for v_preset in
    select value from jsonb_array_elements(new.presets)
  loop
    if jsonb_typeof(v_preset) <> 'object' then
      raise exception using message = 'VALIDATION: 本体Presetの商品参照形式が不正です';
    end if;

    if v_preset ? 'option_codes' then
      if jsonb_typeof(v_preset -> 'option_codes') <> 'array' then
        raise exception using message = 'VALIDATION: 本体Presetの商品参照形式が不正です';
      end if;

      for v_code in
        select value from jsonb_array_elements_text(v_preset -> 'option_codes')
      loop
        if not exists (select 1 from public.options o where o.code = v_code) then
          raise exception using message = 'VALIDATION: 本体Presetに存在しない商品が含まれています';
        end if;
      end loop;
    end if;
  end loop;

  return new;
end;
$$;

alter function public.validate_base_model_preset_option_refs() owner to postgres;
revoke all on function public.validate_base_model_preset_option_refs() from public, anon, authenticated, service_role;

drop trigger if exists base_models_preset_option_refs_validate on public.base_models;
create trigger base_models_preset_option_refs_validate
before insert or update of presets on public.base_models
for each row execute function public.validate_base_model_preset_option_refs();

create or replace function public.validate_estimate_template_baseline_option_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(coalesce(new.baseline_option_ids, '{}'::uuid[])) ref(option_id)
    left join public.options o on o.id = ref.option_id
    where o.id is null
  ) then
    raise exception using message = 'VALIDATION: 標準見積baselineに存在しない商品が含まれています';
  end if;
  return new;
end;
$$;

alter function public.validate_estimate_template_baseline_option_refs() owner to postgres;
revoke all on function public.validate_estimate_template_baseline_option_refs() from public, anon, authenticated, service_role;

drop trigger if exists estimate_templates_baseline_option_refs_validate on public.estimate_templates;
create trigger estimate_templates_baseline_option_refs_validate
before insert or update of baseline_option_ids on public.estimate_templates
for each row execute function public.validate_estimate_template_baseline_option_refs();

create or replace function public.validate_configuration_snapshot_option_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_option_id uuid;
begin
  if new.snapshot ? 'lines' then
    if jsonb_typeof(new.snapshot -> 'lines') <> 'array' then
      raise exception using message = 'VALIDATION: Configuration Snapshotの商品参照形式が不正です';
    end if;

    for v_line in
      select value from jsonb_array_elements(new.snapshot -> 'lines')
    loop
      if jsonb_typeof(v_line) <> 'object' then
        raise exception using message = 'VALIDATION: Configuration Snapshotの商品参照形式が不正です';
      end if;

      if nullif(v_line ->> 'option_id', '') is not null then
        begin
          v_option_id := (v_line ->> 'option_id')::uuid;
        exception when others then
          raise exception using message = 'VALIDATION: Configuration Snapshotの商品参照形式が不正です';
        end;
        if not exists (select 1 from public.options o where o.id = v_option_id) then
          raise exception using message = 'VALIDATION: Configuration Snapshotに存在しない商品が含まれています';
        end if;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

alter function public.validate_configuration_snapshot_option_refs() owner to postgres;
revoke all on function public.validate_configuration_snapshot_option_refs() from public, anon, authenticated, service_role;

drop trigger if exists configuration_snapshots_option_refs_validate on public.configuration_snapshots;
create trigger configuration_snapshots_option_refs_validate
before insert or update of snapshot on public.configuration_snapshots
for each row execute function public.validate_configuration_snapshot_option_refs();

create or replace function public.validate_quote_internal_snapshot_option_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_option_id uuid;
begin
  if jsonb_typeof(new.lines) <> 'array' then
    raise exception using message = 'VALIDATION: Quote内部Snapshotの商品参照形式が不正です';
  end if;

  for v_line in
    select value from jsonb_array_elements(new.lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using message = 'VALIDATION: Quote内部Snapshotの商品参照形式が不正です';
    end if;

    if nullif(v_line ->> 'option_id', '') is not null then
      begin
        v_option_id := (v_line ->> 'option_id')::uuid;
      exception when others then
        raise exception using message = 'VALIDATION: Quote内部Snapshotの商品参照形式が不正です';
      end;
      if not exists (select 1 from public.options o where o.id = v_option_id) then
        raise exception using message = 'VALIDATION: Quote内部Snapshotに存在しない商品が含まれています';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

alter function public.validate_quote_internal_snapshot_option_refs() owner to postgres;
revoke all on function public.validate_quote_internal_snapshot_option_refs() from public, anon, authenticated, service_role;

drop trigger if exists quote_internal_snapshots_option_refs_validate on public.quote_internal_snapshots;
create trigger quote_internal_snapshots_option_refs_validate
before insert on public.quote_internal_snapshots
for each row execute function public.validate_quote_internal_snapshot_option_refs();

create or replace function public.delete_unused_published_option(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '2s'
as $$
declare
  v_option_code text;
  v_option_status text;
  v_used_message constant text := 'VALIDATION: この商品は保存済み仕様・見積・標準見積・履歴・商品ルールで使用されているため削除できません。既存データを保護するため登録済みのまま残してください。';
begin
  if auth.uid() is null then
    raise exception using message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_edit_catalog() then
    raise exception using message = 'FORBIDDEN: 登録済み商品を削除できるのは商品マスター編集権限を持つ担当者だけです';
  end if;

  -- 配列・JSON参照とvariant所属変更のTOCTOUを避ける。
  -- 書込み側は、待機後に上記validation trigger / FK / 保存RPC検証を再実行するため、
  -- DELETE後に消えた商品ID/codeを新たに保存することもできない。
  lock table
    public.base_models,
    public.configuration_items,
    public.configurations,
    public.configuration_snapshots,
    public.estimate_templates,
    public.legacy_migration_financial_snapshots,
    public.option_variant_groups,
    public.option_variant_choices,
    public.quote_internal_snapshots
  in share mode;

  select o.code, o.status
    into v_option_code, v_option_status
  from public.options o
  where o.id = p_option_id
  for update;

  if not found then
    raise exception using message = 'NOT_FOUND: 商品が見つかりません';
  end if;

  if v_option_status <> 'published' then
    raise exception using message = 'VALIDATION: この操作は登録済み商品の誤登録削除専用です。下書き商品は下書き画面から削除してください。';
  end if;

  -- 形式不正を空配列扱いして削除判定を通さない。想定外のlegacy形式は先に是正してから削除する。
  if exists (
    select 1 from public.configurations c
    where jsonb_typeof(c.exterior_faces) <> 'array'
  ) or exists (
    select 1 from public.configuration_snapshots cs
    where (cs.snapshot ? 'lines' and jsonb_typeof(cs.snapshot -> 'lines') <> 'array')
       or exists (
         select 1
         from jsonb_array_elements(case when jsonb_typeof(cs.snapshot -> 'lines') = 'array' then cs.snapshot -> 'lines' else '[]'::jsonb end) line(value)
         where jsonb_typeof(line.value) <> 'object'
       )
  ) or exists (
    select 1 from public.quote_internal_snapshots qis
    where jsonb_typeof(qis.lines) <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(case when jsonb_typeof(qis.lines) = 'array' then qis.lines else '[]'::jsonb end) line(value)
         where jsonb_typeof(line.value) <> 'object'
       )
  ) or exists (
    select 1 from public.base_models bm
    where jsonb_typeof(bm.presets) <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(case when jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) preset(value)
         where jsonb_typeof(preset.value) <> 'object'
            or (preset.value ? 'option_codes' and jsonb_typeof(preset.value -> 'option_codes') <> 'array')
       )
  ) then
    raise exception using message = 'VALIDATION: 商品参照を含む履歴・Presetの形式に異常があります。安全確認ができないため削除を停止しました。';
  end if;

  -- 保存済み仕様。option_idのFKに加え、variant_choice_ids配列からも参照を確認する。
  if exists (
    select 1
    from public.configuration_items ci
    where ci.option_id = p_option_id
       or exists (
         select 1
         from public.option_variant_choices vc
         join public.option_variant_groups vg on vg.id = vc.group_id
         where vg.option_id = p_option_id
           and vc.id = any(coalesce(ci.variant_choice_ids, '{}'::uuid[]))
       )
  ) then
    raise exception using message = v_used_message;
  end if;

  -- 外壁4面など、Configuration本体のJSON保存値。
  if exists (
    select 1
    from public.configurations c
    cross join lateral jsonb_array_elements(c.exterior_faces) as face(value)
    where face.value ->> 'option_id' = p_option_id::text
  ) then
    raise exception using message = v_used_message;
  end if;

  -- Configuration確定時の再現用Snapshot。
  if exists (
    select 1
    from public.configuration_snapshots cs
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cs.snapshot -> 'lines') = 'array' then cs.snapshot -> 'lines' else '[]'::jsonb end
    ) as snapshot_line(value)
    where snapshot_line.value ->> 'option_id' = p_option_id::text
  ) then
    raise exception using message = v_used_message;
  end if;

  -- 見積Draft / 発行済み見積。FK RESTRICTでも保護されるが、業務向けの明示エラーを先に返す。
  if exists (select 1 from public.quote_draft_items qdi where qdi.option_id = p_option_id)
     or exists (select 1 from public.quote_items qi where qi.option_id = p_option_id) then
    raise exception using message = v_used_message;
  end if;

  -- 標準見積Revisionの固定baseline。
  if exists (
    select 1
    from public.standard_estimate_revision_baseline_items bi
    where bi.option_id = p_option_id
  ) then
    raise exception using message = v_used_message;
  end if;

  -- legacy標準見積のbaseline配列。
  if exists (
    select 1
    from public.estimate_templates et
    where p_option_id = any(coalesce(et.baseline_option_ids, '{}'::uuid[]))
  ) then
    raise exception using message = v_used_message;
  end if;

  -- legacy移行監査Snapshotも履歴として保持する。
  if exists (
    select 1
    from public.legacy_migration_financial_snapshots ls
    where p_option_id = any(coalesce(ls.legacy_baseline_option_ids, '{}'::uuid[]))
  ) then
    raise exception using message = v_used_message;
  end if;

  -- Quote内部Snapshotが商品IDを保持している場合も履歴を壊さない。
  if exists (
    select 1
    from public.quote_internal_snapshots qis
    cross join lateral jsonb_array_elements(qis.lines) as quote_line(value)
    where quote_line.value ->> 'option_id' = p_option_id::text
  ) then
    raise exception using message = v_used_message;
  end if;

  -- 他商品の依存/競合ルールをCASCADEで黙って消さない。
  if exists (
    select 1
    from public.option_dependencies d
    where d.option_id = p_option_id or d.requires_option_id = p_option_id
  ) or exists (
    select 1
    from public.option_conflicts c
    where c.option_id = p_option_id or c.conflicts_with_option_id = p_option_id
  ) then
    raise exception using message = v_used_message;
  end if;

  -- 本体Presetは商品codeをJSONで保持するため、UUIDのFKでは守れない。
  if exists (
    select 1
    from public.base_models bm
    cross join lateral jsonb_array_elements(bm.presets) as preset(value)
    cross join lateral jsonb_array_elements_text(
      case when preset.value ? 'option_codes' then preset.value -> 'option_codes' else '[]'::jsonb end
    ) as preset_option(code)
    where preset_option.code = v_option_code
  ) then
    raise exception using message = v_used_message;
  end if;

  delete from public.options o where o.id = p_option_id;

  if not found then
    raise exception using message = 'NOT_FOUND: 商品が見つかりません';
  end if;
end;
$$;

alter function public.delete_unused_published_option(uuid) owner to postgres;

revoke all on function public.delete_unused_published_option(uuid) from public;
revoke all on function public.delete_unused_published_option(uuid) from anon;
revoke all on function public.delete_unused_published_option(uuid) from authenticated;
revoke all on function public.delete_unused_published_option(uuid) from service_role;
grant execute on function public.delete_unused_published_option(uuid) to authenticated;

-- service_roleはRLSを迂回するため、publishedの直接DELETE経路をtable ACLでも閉じる。
-- authenticatedのDELETEは既存draft削除に必要なので残し、RLSでdraft限定にする。
revoke delete on table public.options from service_role;
-- TRUNCATEは行単位RLSを通らないためapplication roleには不要。
revoke truncate on table public.options from anon, authenticated, service_role;

-- 通常のauthenticated RLS経由DELETEはdraftだけ許可する。publishedは安全削除RPCを利用する。
drop policy if exists options_published_delete_via_safe_rpc_only on public.options;
create policy options_published_delete_via_safe_rpc_only
on public.options
as restrictive
for delete
to public
using (status = 'draft');
