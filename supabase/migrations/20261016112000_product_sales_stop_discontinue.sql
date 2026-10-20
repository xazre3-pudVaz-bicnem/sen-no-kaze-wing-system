-- 販売停止・廃番（2026-10-19 の先方回答 ②・③ の ①。#500 の最小修正）
--
-- 先方の方針
--   ・販売停止：公開中の標準見積・本体の標準構成で使用中でも止められる。止めた商品は新しい選択・新しい見積への採用・正式発行に使えない。
--     既存の下書き・公開中・発行済み・Snapshot は変えない。再開は仕様・供給・価格を確認したうえでできる
--   ・①：標準構成の中の販売停止の商品も、新しい販売・新しい正式見積に使えない。未承認の自動の差し替えはしない。
--     必要な標準構成が成り立たない場合は、その構成の新しい受付を止める。再開は確認済みの構成の新しい Revision で
--   ・廃番：原則再開しない。誤操作は本部の管理者が理由を記録して復元する。操作の履歴を残す。
--     復元しても販売・全国公開は自動で再開しない（販売停止に戻る）
--
-- 変えること
--   1. options.archived_at（#500 の「取扱終了」）を「販売停止」として扱い、廃番の印 options.discontinued_at を足す（廃番は販売停止の商品だけ）
--   2. 販売停止を止めていた参照のうち、公開中の標準見積の標準状態・Excel 標準見積の基準商品・本体の仕様（標準の商品構成）を外す。
--      必須・初期選択・前提商品の止めは今のまま（先に設定を外す＝本部の明示の判断）
--   3. 廃番の商品は販売を再開できない。廃番にする・取り消すは専用の RPC から理由つきで行い、取り消しは本部の管理者だけ（取り消すと販売停止に戻る）
--   4. 販売停止・再開・廃番・取り消し・シミュレーター表示の変更を変更履歴（audit_logs）に残す（廃番・取り消しは理由も）
--   5. ①：標準構成（Excel 標準の基準商品・公開中の標準見積の標準状態・本体の仕様）に販売停止・廃番の商品がある仕様は、
--      新しい見積依頼を受け付けない。標準見積から作る新しい見積の下書き・正式発行も止める
-- 既存 migration は編集しない。商品・見積・標準見積のデータは変えない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.options_lifecycle_guard()') is null
     or to_regprocedure('public.product_lifecycle_baseline_option_ids(uuid, text)') is null
     or to_regprocedure('public.trg_audit_option()') is null
     or to_regprocedure('public.write_audit(text, text, uuid, text, jsonb, jsonb)') is null then
    raise exception 'PRECONDITION: product lifecycle (20261015113000) and audit functions must be applied first';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'options' and column_name = 'discontinued_at'
  ) then
    raise exception 'PRECONDITION: options.discontinued_at already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 廃番の印 ----------

alter table public.options
  add column discontinued_at timestamptz,
  add constraint options_discontinued_requires_stopped check (discontinued_at is null or archived_at is not null);

comment on column public.options.discontinued_at is
  '廃番にした日時。廃番は販売停止（archived_at あり）の商品だけ。原則再開しない。誤操作は本部の管理者が理由を記録して取り消す（取り消すと販売停止に戻る）。';
comment on column public.options.archived_at is
  '販売停止にした日時（2026-10-19 の先方回答で、#500 の「取扱終了」を販売停止と呼ぶ）。新しい選択・見積・正式発行に使えない。再開できる（廃番の間は再開できない）。';


-- ---------- 商品の状態の変更（販売停止・再開・廃番・取り消し・シミュレーター表示） ----------

create or replace function public.options_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_reason text := nullif(btrim(coalesce(current_setting('wing.option_lifecycle_reason', true), '')), '');
begin
  -- 廃番の印（専用の RPC から理由つきで変える）
  if new.discontinued_at is distinct from old.discontinued_at then
    if old.discontinued_at is null and new.discontinued_at is not null then
      if old.archived_at is null or new.archived_at is null then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 廃番にできるのは販売停止の商品だけです。先に販売を停止してください';
      end if;
      if v_reason is null then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 廃番にする理由を入力してください';
      end if;
    elsif old.discontinued_at is not null and new.discontinued_at is null then
      -- 取り消し（誤操作の復元）：本部の管理者だけ。販売は再開しない（販売停止に戻る）
      if not public.is_admin() then
        raise exception using errcode = '42501',
          message = 'FORBIDDEN: 廃番を取り消せるのは本部の管理者だけです';
      end if;
      if v_reason is null then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 廃番を取り消す理由を入力してください';
      end if;
      if new.archived_at is null then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 廃番を取り消しても販売は再開しません（販売停止に戻ります）。販売の再開は別の操作で行ってください';
      end if;
    else
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: 廃番の日時は変更できません';
    end if;
  end if;

  if new.archived_at is distinct from old.archived_at then
    if old.archived_at is null and new.archived_at is not null then
      -- 販売停止：登録済みの商品だけ。公開中の標準見積・Excel 標準見積・本体の仕様で使用中でも止められる（10/19 の確定方針。
      -- その仕様は新しい受付を止める）。必須・初期選択・前提商品は、先に設定を見直す（本部の明示の判断）
      if new.status is distinct from 'published' or old.status is distinct from 'published' then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 販売停止にできるのは登録済みの商品だけです。下書きは不要なら削除してください';
      end if;
      if new.is_required or new.is_default then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: 必須・初期選択の商品は販売停止にできません。先に必須・初期選択の設定を外してください';
      end if;
      select o.name into v_name
        from public.option_dependencies d
        join public.options o on o.id = d.option_id
       where d.requires_option_id = new.id
         and o.id <> new.id
         and o.status = 'published'
         and o.archived_at is null
       order by o.sort_order, o.id
       limit 1;
      if v_name is not null then
        raise exception using errcode = 'P0001',
          message = format('LOCKED: 「%s」の前提商品として使われているため、販売停止にできません。先に前提の設定を見直してください', v_name);
      end if;
    elsif old.archived_at is not null and new.archived_at is null then
      -- 販売の再開：廃番の間は再開しない。シミュレーター表示は以前の値のまま
      if old.discontinued_at is not null or new.discontinued_at is not null then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: 廃番の商品は販売を再開できません。誤って廃番にした場合は、本部の管理者が廃番を取り消してください（取り消すと販売停止に戻ります）';
      end if;
    else
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: 販売停止の日時は変更できません。販売を再開してから、改めて停止してください';
    end if;
  end if;

  if new.simulator_visible is distinct from old.simulator_visible then
    if new.status is distinct from 'published' or new.archived_at is not null or old.archived_at is not null then
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: シミュレーター表示は、販売中の登録済み商品だけで設定できます';
    end if;
  end if;
  return new;
end;
$$;

drop trigger options_lifecycle_guard on public.options;
create trigger options_lifecycle_guard
before update of archived_at, simulator_visible, discontinued_at on public.options
for each row execute function public.options_lifecycle_guard();

-- ---------- 変更履歴（販売停止・再開・廃番・取り消し・シミュレーター表示） ----------

create or replace function public.trg_audit_option()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(current_setting('wing.option_lifecycle_reason', true), '')), '');
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('create', 'option', new.id, '商品を追加：' || new.name, null,
      jsonb_build_object('price', new.price, 'status', new.status));
    return new;
  end if;
  if new.price is distinct from old.price then
    perform public.write_audit('price', 'option', new.id,
      '価格を変更：' || new.name || '（' || old.price || ' → ' || new.price || ' 円）',
      jsonb_build_object('price', old.price), jsonb_build_object('price', new.price));
  end if;
  if new.status is distinct from old.status then
    perform public.write_audit('status', 'option', new.id,
      '公開状態を変更：' || new.name || '（' || old.status || ' → ' || new.status || '）',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform public.write_audit('lifecycle', 'option', new.id,
      case when new.archived_at is not null then '販売を停止：' else '販売を再開：' end || new.name,
      jsonb_build_object('archived_at', old.archived_at), jsonb_build_object('archived_at', new.archived_at));
  end if;
  if new.discontinued_at is distinct from old.discontinued_at then
    perform public.write_audit('lifecycle', 'option', new.id,
      case when new.discontinued_at is not null then '廃番にした：' else '廃番を取り消した（販売停止に戻した）：' end
        || new.name || coalesce('（理由：' || v_reason || '）', ''),
      jsonb_build_object('discontinued_at', old.discontinued_at),
      jsonb_build_object('discontinued_at', new.discontinued_at, 'reason', v_reason));
  end if;
  if new.simulator_visible is distinct from old.simulator_visible then
    perform public.write_audit('lifecycle', 'option', new.id,
      case when new.simulator_visible then 'シミュレーターに表示：' else 'シミュレーターに表示しない：' end || new.name,
      jsonb_build_object('simulator_visible', old.simulator_visible), jsonb_build_object('simulator_visible', new.simulator_visible));
  end if;
  return new;
end;
$$;

-- ---------- 廃番にする・取り消す（理由つき） ----------

create function public.set_option_discontinued(
  p_option_id uuid,
  p_expected_updated_at timestamptz,
  p_discontinued boolean,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 廃番にするのは商品台帳を編集できる人（販売停止と同じ）。取り消しは本部の管理者だけ（トリガーでも確かめる）
  if not public.can_edit_catalog() or (not coalesce(p_discontinued, false) and not public.is_admin()) then
    raise exception 'FORBIDDEN: この操作の権限がありません' using errcode = '42501';
  end if;
  if p_discontinued is null or p_expected_updated_at is null then
    raise exception 'VALIDATION: 操作の内容が正しくありません' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'VALIDATION: 理由を 500 文字以内で入力してください' using errcode = 'P0001';
  end if;
  perform set_config('wing.option_lifecycle_reason', v_reason, true);
  update public.options
     set discontinued_at = case when p_discontinued then now() else null end
   where id = p_option_id
     and updated_at = p_expected_updated_at
     and (discontinued_at is null) = p_discontinued
  returning updated_at into v_updated_at;
  perform set_config('wing.option_lifecycle_reason', '', true);
  if v_updated_at is null then
    raise exception 'LOCKED: 他の画面で商品が更新されたため、操作できませんでした。再読み込みしてから、もう一度操作してください'
      using errcode = 'P0001';
  end if;
  return v_updated_at;
end;
$$;

-- ---------- ①：標準構成に販売停止・廃番の商品がある仕様は、新しい受付を止める ----------

-- 仕様（モデル・仕様コード）の標準構成にある販売停止・廃番の商品の名前（無ければ空）
create function public.spec_stopped_baseline_names(p_model_id uuid, p_spec_code text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name order by o.sort_order, o.id), '{}'::text[])
    from public.options o
   where o.id = any(public.product_lifecycle_baseline_option_ids(p_model_id, p_spec_code))
     and public.product_lifecycle_state(o.status, o.archived_at) = 'retired';
$$;

-- 画面用（シミュレーター・見積依頼・スタッフの新規見積）：この仕様で新しい受付ができるか
create function public.get_spec_acceptance_state(p_model_id uuid, p_spec_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accepting', cardinality(public.spec_stopped_baseline_names(p_model_id, p_spec_code)) = 0,
    'stopped_names', to_jsonb(public.spec_stopped_baseline_names(p_model_id, p_spec_code))
  );
$$;

create function public.quote_requests_baseline_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.configurations;
  v_names text[];
begin
  if new.configuration_id is null then
    return new;
  end if;
  select * into v_cfg from public.configurations where id = new.configuration_id;
  if not found then
    return new;
  end if;
  -- 販売停止の操作と同時に来ても、確定した状態で判定する（標準構成の商品の行を共有ロック）
  perform 1
    from public.options o
   where o.id = any(public.product_lifecycle_baseline_option_ids(v_cfg.base_model_id, v_cfg.spec_code))
   order by o.id
   for share;
  v_names := public.spec_stopped_baseline_names(v_cfg.base_model_id, v_cfg.spec_code);
  if cardinality(v_names) > 0 then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: この仕様の標準の商品構成に、販売停止の商品（%s）が含まれるため、現在は新しいご依頼を受け付けていません。担当からのご案内をお待ちください',
                       array_to_string(v_names, '・'));
  end if;
  return new;
end;
$$;

create trigger quote_requests_baseline_lifecycle_guard
before insert on public.quote_requests
for each row execute function public.quote_requests_baseline_lifecycle_guard();


-- ---------- ①：標準見積から作る見積（下書き・正式発行） ----------

-- 標準見積の Revision の標準状態にある販売停止・廃番の商品の名前（無ければ空）
create function public.standard_estimate_stopped_baseline_names(p_revision_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct o.name), '{}'::text[])
    from public.standard_estimate_revision_baseline_items b
    join public.options o on o.id = b.option_id
   where b.revision_id = p_revision_id
     and public.product_lifecycle_state(o.status, o.archived_at) = 'retired';
$$;

-- 標準見積から作る見積の下書き（新しい案件・次の版）：標準状態に販売停止の商品があれば作らない
create function public.quote_drafts_standard_estimate_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text[];
begin
  if new.source_kind is distinct from 'standard_estimate' or new.standard_estimate_revision_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.standard_estimate_revision_id is not distinct from old.standard_estimate_revision_id then
    return new;
  end if;
  perform 1
    from public.standard_estimate_revision_baseline_items b
    join public.options o on o.id = b.option_id
   where b.revision_id = new.standard_estimate_revision_id
   order by o.id
   for share of o;
  v_names := public.standard_estimate_stopped_baseline_names(new.standard_estimate_revision_id);
  if cardinality(v_names) > 0 then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: 標準見積の標準状態に、販売停止の商品（%s）が含まれるため、この標準見積から新しい見積は作れません。確認済みの構成で標準見積の新しい Revision を公開してください',
                       array_to_string(v_names, '・'));
  end if;
  return new;
end;
$$;

create trigger quote_drafts_standard_estimate_lifecycle_guard
before insert or update of standard_estimate_revision_id on public.quote_drafts
for each row execute function public.quote_drafts_standard_estimate_lifecycle_guard();

-- 正式発行の前（下書きを作った後に販売停止になった場合）
create function public.assert_standard_estimate_source_sellable(p_draft_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_revision_id uuid;
  v_names text[];
begin
  select d.standard_estimate_revision_id into v_revision_id
    from public.quote_drafts d
   where d.id = p_draft_id
     and d.source_kind = 'standard_estimate';
  if v_revision_id is null then
    return;
  end if;
  v_names := public.standard_estimate_stopped_baseline_names(v_revision_id);
  if cardinality(v_names) > 0 then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: 標準見積の標準状態に、販売停止の商品（%s）が含まれるため、この見積は正式に発行できません。確認済みの構成で標準見積の新しい Revision を公開し、そこから見積を作り直してください',
                       array_to_string(v_names, '・'));
  end if;
end;
$$;


-- ---------- 権限 ----------

alter function public.options_lifecycle_guard() owner to postgres;
alter function public.trg_audit_option() owner to postgres;
alter function public.set_option_discontinued(uuid, timestamptz, boolean, text) owner to postgres;
alter function public.spec_stopped_baseline_names(uuid, text) owner to postgres;
alter function public.get_spec_acceptance_state(uuid, text) owner to postgres;
alter function public.quote_requests_baseline_lifecycle_guard() owner to postgres;
alter function public.standard_estimate_stopped_baseline_names(uuid) owner to postgres;
alter function public.quote_drafts_standard_estimate_lifecycle_guard() owner to postgres;
alter function public.assert_standard_estimate_source_sellable(uuid) owner to postgres;

-- 内部の部品・トリガーの関数は利用者から実行させない
revoke execute on function public.spec_stopped_baseline_names(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.standard_estimate_stopped_baseline_names(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.assert_standard_estimate_source_sellable(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.quote_requests_baseline_lifecycle_guard() from public, anon, authenticated, service_role;
revoke execute on function public.quote_drafts_standard_estimate_lifecycle_guard() from public, anon, authenticated, service_role;

-- 廃番の操作はログインした利用者（関数の中で商品台帳の編集権限・本部の管理者を確かめる）
revoke execute on function public.set_option_discontinued(uuid, timestamptz, boolean, text) from public, anon, service_role;
grant execute on function public.set_option_discontinued(uuid, timestamptz, boolean, text) to authenticated;

-- 受付ができるかは、ログインした利用者の画面（シミュレーター・見積依頼・スタッフの新規見積）で使う。
-- 見積依頼はログインが必要なため、ログイン前（anon）には開かない（anon から実行できる SECURITY DEFINER は RLS の判定関数だけ）
revoke execute on function public.get_spec_acceptance_state(uuid, text) from public, anon, service_role;
grant execute on function public.get_spec_acceptance_state(uuid, text) to authenticated;

comment on function public.set_option_discontinued(uuid, timestamptz, boolean, text) is
  '廃番にする（販売停止の商品だけ・商品台帳を編集できる人）／取り消す（本部の管理者だけ・販売停止に戻る）。理由は必須で、変更履歴に残す。画面が読んだ版（updated_at）でなければ LOCKED。';
comment on function public.get_spec_acceptance_state(uuid, text) is
  '仕様（モデル・仕様コード）の標準構成に販売停止・廃番の商品があるか（accepting・stopped_names）。ある間は新しい見積依頼・標準見積からの新しい見積を受け付けない。';

-- ---------- 正式保存の 2 つの関数：標準見積から作った下書きの正式発行の前に、標準状態の販売停止を確かめる ----------

do $patch_finalize$
declare
  v_signatures constant text[] := array[
    'public.finalize_quote_draft(uuid, integer)',
    'public.finalize_quote_revision_draft(uuid, integer)'
  ];
  v_anchor constant text :=
    E'  if d.source_kind = ''standard_estimate'' and v_rank < 3 then\n'
    || E'    raise exception ''FORBIDDEN: 標準見積から作成した見積は、現在は本部管理者だけが発行できます'' using errcode = ''42501'';\n'
    || E'  end if;\n';
  v_insert constant text :=
    E'  /* 標準見積から作った見積は、標準状態に販売停止の商品があれば正式に発行しない（2026-10-19 の先方回答 ③ の ①）。 */\n'
    || E'  perform public.assert_standard_estimate_source_sellable(d.id);\n';
  v_index integer;
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
begin
  for v_index in 1 .. array_length(v_signatures, 1) loop
    v_oid := to_regprocedure(v_signatures[v_index]);
    if v_oid is null then
      raise exception 'PRODUCT_SALES_STOP: function % is missing', v_signatures[v_index] using errcode = 'P0001';
    end if;
    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if strpos(v_definition, 'assert_standard_estimate_source_sellable(') > 0 then
      raise exception 'PRODUCT_SALES_STOP: % is already patched', v_signatures[v_index] using errcode = 'P0001';
    end if;
    if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
      raise exception 'PRODUCT_SALES_STOP: % differs from the reviewed definition (anchor is not unique)', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_definition, v_anchor, v_anchor || v_insert);

    execute v_expected;

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
      raise exception 'PRODUCT_SALES_STOP: % was not replaced as expected', v_signatures[v_index] using errcode = 'P0001';
    end if;
    if v_after.proowner is distinct from v_before.proowner
       or v_after.prosecdef is distinct from v_before.prosecdef
       or v_after.proconfig is distinct from v_before.proconfig
       or v_after.acl is distinct from v_before.acl then
      raise exception 'PRODUCT_SALES_STOP: % owner / security definer / search_path / EXECUTE changed', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
  end loop;
end;
$patch_finalize$;

-- ---------- #500 の止めの文言：「取扱終了」→「販売停止中」（判定は変えない） ----------

do $patch_messages$
declare
  v_signatures constant text[] := array[
    'public.configuration_items_lifecycle_guard()',
    'public.configurations_exterior_lifecycle_guard()',
    'public.estimate_templates_lifecycle_guard()',
    'public.quote_draft_items_lifecycle_guard()',
    'public.quote_items_lifecycle_guard()',
    'public.quote_requests_lifecycle_guard()',
    'public.standard_estimate_baseline_lifecycle_guard()',
    'public.standard_estimate_baseline_variant_lifecycle_guard()',
    'public.standard_estimate_publish_lifecycle_guard()'
  ];
  v_from constant text[] := array[
    '「%s」は取扱終了のため新しく選べません。取扱の再開を待つか、別の商品へ変更してください',
    '外壁「%s」は取扱終了のため新しく選べません。取扱の再開を待つか、別の商品へ変更してください',
    '%s は取扱終了のため、基準商品に新しく入れられません',
    '「%s」は取扱終了のため新しく選べません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）',
    '「%s」は取扱終了のため、この内容では見積を発行できません。取扱を再開するか、別の商品へ変更してください',
    '%s は取扱終了のため、この内容では見積を依頼できません。取扱の再開を待つか、別の商品へ変更してください',
    '「%s」は取扱終了のため、標準状態に新しく入れられません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）',
    '「%s」は取扱終了のため、選択肢を変えられません',
    '%s は取扱終了のため、この標準状態では公開できません。標準状態から外すか、取扱を再開してください'
  ];
  v_to constant text[] := array[
    '「%s」は販売停止中のため新しく選べません。販売の再開を待つか、別の商品へ変更してください',
    '外壁「%s」は販売停止中のため新しく選べません。販売の再開を待つか、別の商品へ変更してください',
    '%s は販売停止中のため、基準商品に新しく入れられません',
    '「%s」は販売停止中のため新しく選べません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）',
    '「%s」は販売停止中のため、この内容では見積を発行できません。販売を再開するか、別の商品へ変更してください',
    '%s は販売停止中のため、この内容では見積を依頼できません。販売の再開を待つか、別の商品へ変更してください',
    '「%s」は販売停止中のため、標準状態に新しく入れられません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）',
    '「%s」は販売停止中のため、選択肢を変えられません',
    '%s は販売停止中のため、この標準状態では公開できません。標準状態から外すか、販売を再開してください'
  ];
  v_index integer;
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
begin
  for v_index in 1 .. array_length(v_signatures, 1) loop
    v_oid := to_regprocedure(v_signatures[v_index]);
    if v_oid is null then
      raise exception 'PRODUCT_SALES_STOP: function % is missing', v_signatures[v_index] using errcode = 'P0001';
    end if;
    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    -- 「取扱終了」はこの文言の 1 箇所だけ（ほかに残さない）
    if (length(v_definition) - length(replace(v_definition, '取扱終了', ''))) / length('取扱終了') <> 1
       or (length(v_definition) - length(replace(v_definition, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'PRODUCT_SALES_STOP: % differs from the reviewed definition (message is not unique)', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_definition, v_from[v_index], v_to[v_index]);

    execute v_expected;

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
      raise exception 'PRODUCT_SALES_STOP: % was not replaced as expected', v_signatures[v_index] using errcode = 'P0001';
    end if;
    if v_after.proowner is distinct from v_before.proowner
       or v_after.prosecdef is distinct from v_before.prosecdef
       or v_after.proconfig is distinct from v_before.proconfig
       or v_after.acl is distinct from v_before.acl then
      raise exception 'PRODUCT_SALES_STOP: % owner / security definer / search_path / EXECUTE changed', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
  end loop;
end;
$patch_messages$;

commit;
