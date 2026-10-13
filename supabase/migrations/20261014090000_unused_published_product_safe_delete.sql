-- 登録済み商品は、見積・仕様・履歴・標準見積・商品ルール等で一度も使われていない場合だけ削除できる。
-- 下書き商品の既存削除フローは維持し、published の直接 DELETE は RLS で閉じて本 RPC に限定する。

create or replace function public.delete_unused_published_option(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_option_code text;
  v_option_status text;
  v_used_message constant text := 'VALIDATION: この商品は保存済み仕様・見積・標準見積・履歴・商品ルールで使用されているため削除できません。削除せず非公開で管理してください。';
begin
  if auth.uid() is null then
    raise exception using message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_edit_catalog() then
    raise exception using message = 'FORBIDDEN: 登録済み商品を削除できるのは商品マスター編集権限を持つ担当者だけです';
  end if;

  -- UUID/FKでは表現されていない配列・JSON参照とのTOCTOUを避けるため、
  -- 参照確認中だけ該当テーブルの書込みを止める。削除はまれな管理操作なので短時間のSHARE lockとする。
  lock table
    public.base_models,
    public.configurations,
    public.configuration_snapshots,
    public.estimate_templates,
    public.legacy_migration_financial_snapshots,
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
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.exterior_faces) = 'array' then c.exterior_faces else '[]'::jsonb end
    ) face
    where face ->> 'option_id' = p_option_id::text
  ) then
    raise exception using message = v_used_message;
  end if;

  -- Configuration確定時の再現用Snapshot。
  if exists (
    select 1
    from public.configuration_snapshots cs
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(cs.snapshot -> 'lines') = 'array' then cs.snapshot -> 'lines'
        else '[]'::jsonb
      end
    ) line
    where line ->> 'option_id' = p_option_id::text
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
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(qis.lines) = 'array' then qis.lines else '[]'::jsonb end
    ) line
    where line ->> 'option_id' = p_option_id::text
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
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end
    ) preset
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(preset -> 'option_codes') = 'array' then preset -> 'option_codes'
        else '[]'::jsonb
      end
    ) preset_option_code
    where preset_option_code = v_option_code
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

-- 通常のRLS経由DELETEはdraftだけ許可する。publishedは上のSECURITY DEFINER RPCだけが削除経路。
drop policy if exists options_published_delete_via_safe_rpc_only on public.options;
create policy options_published_delete_via_safe_rpc_only
on public.options
as restrictive
for delete
to public
using (status = 'draft');
