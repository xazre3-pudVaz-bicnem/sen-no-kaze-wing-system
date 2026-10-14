-- PR #482 hardening（101000 の後に適用する最終形）。
--
-- 1. options.code を登録後に変えない（本体 Preset は商品を code で参照するため）。
-- 2. 商品の参照確認を「商品を削除する」トリガーへ移し、削除経路に関係なく同じ確認を通す。
--    登録済み商品の安全削除 RPC・下書きの削除（published → draft に戻してからの削除を含む）・
--    本体からの連鎖削除など、どの経路でも、使用中の商品（Preset の code・外壁 4 面の JSON など FK の無い参照を含む）は消せない。
-- 3. 確認中の書込み競合：参照を持つ表を SHARE で lock してから確認する（確認と DELETE の間に参照を書き込ませない）。
--    lock は待たずに取り（NOWAIT）、取れなければ手放して 0.1 秒おき、最大 15 回やり直す。それでも取れなければ
--    「使用中」で中断する。削除側は表の lock を待たないので、保存（表 → 商品行の順に lock する）などの既存の書込みと
--    deadlock にならず、保存を壊さない。lock の待ちは商品行の lock だけで、lock_timeout（2 秒）までに限る。

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

-- 商品が「正式な業務データ」から参照されていないことを確かめる。使用中なら VALIDATION、表が使用中なら LOCKED で止める。
-- options の削除トリガー（guard_option_delete）からだけ呼ぶ。application role からは実行させない。
create or replace function public.assert_option_unreferenced(p_option_id uuid, p_option_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used_message constant text := 'VALIDATION: この商品は保存済み仕様・見積・標準見積・履歴・本体の標準構成・商品ルールで使用されているため削除できません。';
  v_busy_message constant text := 'LOCKED: 現在ほかの処理で使用中のため削除できません。少し時間をおいて再度お試しください。';
  v_attempt integer := 0;
begin
  -- このトリガーは商品行を lock した後に動く。ここで表の lock を待つと、表 → 商品行（FK）の順に lock する
  -- 保存処理と循環しうるので、待たずに取ってやり直す。表の順序は既存の書込み（保存・見積依頼・取込）と同じ向き
  loop
    begin
      lock table
        public.configurations,
        public.configuration_items,
        public.configuration_snapshots,
        public.quote_internal_snapshots,
        public.estimate_templates,
        public.legacy_migration_financial_snapshots,
        public.base_models,
        public.option_variant_groups,
        public.option_variant_choices
      in share mode nowait;
      exit;
    exception when lock_not_available then
      v_attempt := v_attempt + 1;
      if v_attempt >= 15 then
        raise exception using errcode = 'P0001', message = v_busy_message;
      end if;
      perform pg_catalog.pg_sleep(0.1);
    end;
  end loop;

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
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品参照を含む履歴・Presetの形式に異常があります。安全確認ができないため削除を停止しました。';
  end if;

  -- Preset は商品を code で参照するため UUID の FK では守れない。immutable code のトリガーで新たなずれは防ぐが、
  -- legacy や管理外の変更で既に消えた code が残っていれば、どの商品の削除も止める。
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
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本体Presetに存在しない商品codeが含まれています。安全確認ができないため削除を停止しました。';
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
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- 外壁4面など、Configuration本体のJSON保存値。
  if exists (
    select 1
    from public.configurations c
    cross join lateral jsonb_array_elements(c.exterior_faces) as face(value)
    where face.value ->> 'option_id' = p_option_id::text
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
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
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- 見積Draft / 発行済み見積。FK RESTRICTでも保護されるが、業務向けの明示エラーを先に返す。
  if exists (select 1 from public.quote_draft_items qdi where qdi.option_id = p_option_id)
     or exists (select 1 from public.quote_items qi where qi.option_id = p_option_id) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- 標準見積Revisionの固定baseline。
  if exists (
    select 1
    from public.standard_estimate_revision_baseline_items bi
    where bi.option_id = p_option_id
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- legacy標準見積のbaseline配列。
  if exists (
    select 1
    from public.estimate_templates et
    where p_option_id = any(coalesce(et.baseline_option_ids, '{}'::uuid[]))
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- legacy移行監査Snapshotも履歴として保持する。
  if exists (
    select 1
    from public.legacy_migration_financial_snapshots ls
    where p_option_id = any(coalesce(ls.legacy_baseline_option_ids, '{}'::uuid[]))
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- Quote内部Snapshotが商品IDを保持している場合も履歴を壊さない。
  if exists (
    select 1
    from public.quote_internal_snapshots qis
    cross join lateral jsonb_array_elements(qis.lines) as quote_line(value)
    where quote_line.value ->> 'option_id' = p_option_id::text
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
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
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;

  -- 本体Presetの標準構成（code参照）。
  if exists (
    select 1
    from public.base_models bm
    cross join lateral jsonb_array_elements(bm.presets) as preset(value)
    cross join lateral jsonb_array_elements_text(
      case when preset.value ? 'option_codes' then preset.value -> 'option_codes' else '[]'::jsonb end
    ) as preset_option(code)
    where preset_option.code = p_option_code
  ) then
    raise exception using errcode = 'P0001', message = v_used_message;
  end if;
end;
$$;

alter function public.assert_option_unreferenced(uuid, text) owner to postgres;
revoke all on function public.assert_option_unreferenced(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.guard_option_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_option_unreferenced(old.id, old.code);
  return old;
end;
$$;

alter function public.guard_option_delete() owner to postgres;
revoke all on function public.guard_option_delete() from public, anon, authenticated, service_role;

-- どの削除経路（RPC・下書きの DELETE・本体からの連鎖削除・SECURITY DEFINER の関数）でも同じ確認を通す。
drop trigger if exists options_delete_reference_guard on public.options;
create trigger options_delete_reference_guard
before delete on public.options
for each row execute function public.guard_option_delete();

-- 登録済み商品の安全削除 RPC。101000 の定義（application role へは未公開）を置き換える。
-- 参照確認は削除トリガーが行う。この関数は権限・状態の確認と、使用中の扱い（待ち続けない・raw の 40P01 を返さない）を受け持つ。
create or replace function public.delete_unused_published_option(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_status text;
  v_busy_message constant text := 'LOCKED: 現在ほかの処理で使用中のため削除できません。少し時間をおいて再度お試しください。';
begin
  if auth.uid() is null then
    raise exception using message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_edit_catalog() then
    raise exception using message = 'FORBIDDEN: 登録済み商品を削除できるのは商品マスター編集権限を持つ担当者だけです';
  end if;

  select o.status into v_status from public.options o where o.id = p_option_id;
  if not found then
    raise exception using message = 'NOT_FOUND: 商品が見つかりません';
  end if;
  if v_status <> 'published' then
    raise exception using message = 'VALIDATION: この操作は登録済み商品の誤登録削除専用です。下書き商品は下書き画面から削除してください。';
  end if;

  begin
    -- 商品行の lock を待つのは lock_timeout まで。参照確認は削除トリガーが表の lock を取ってから行う
    delete from public.options o where o.id = p_option_id and o.status = 'published';
    if not found then
      raise exception using message = 'NOT_FOUND: 商品が見つかりません';
    end if;
  exception
    when lock_not_available or deadlock_detected then
      raise exception using errcode = 'P0001', message = v_busy_message;
  end;
end;
$$;

alter function public.delete_unused_published_option(uuid) owner to postgres;
revoke all on function public.delete_unused_published_option(uuid) from public, anon, authenticated, service_role;
-- hardeningが最後まで成功した時点で初めて公開する。
grant execute on function public.delete_unused_published_option(uuid) to authenticated;

-- 最終状態の公開境界をmigration自身で検証する。
do $postcondition$
begin
  if has_function_privilege('public', 'public.delete_unused_published_option(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.delete_unused_published_option(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_unused_published_option(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.delete_unused_published_option(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: hardened safe-delete RPC must be executable by authenticated only';
  end if;

  if has_function_privilege('public', 'public.assert_option_unreferenced(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.assert_option_unreferenced(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_option_unreferenced(uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.assert_option_unreferenced(uuid, text)', 'EXECUTE')
     or has_function_privilege('public', 'public.guard_option_delete()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_option_delete()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_option_delete()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_option_delete()', 'EXECUTE') then
    raise exception 'POSTCONDITION: delete guard functions must not be executable by application roles';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.options'::regclass
       and t.tgname = 'options_delete_reference_guard'
       and not t.tgisinternal
       and t.tgenabled = 'O'
  ) then
    raise exception 'POSTCONDITION: options delete reference guard trigger is missing';
  end if;
end;
$postcondition$;
