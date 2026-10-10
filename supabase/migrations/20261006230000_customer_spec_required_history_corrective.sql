-- 本体分類表 corrective の追加是正：必須判定と既存 non-draft 履歴。
--
-- 20261006183000 / 20261006220000 は編集せず、その直後に適用する。
-- テーブル・データは変更しない（関数定義のみ）。
--
-- 1. 必須判定（is_required）と本体分類表の × を同じ正本で整合させる
--    validate_configuration_items() は仕様（spec_code）を受け取らないため、本体分類表で制御する
--    カテゴリーを「全仕様で必須」と判定してしまい、× の仕様（例: 事務所用の室内建具）が保存不能になる。
--    is_required を一律 false にはしない。分類表で制御するカテゴリーの必須判定だけを、
--    モデル・仕様が確定している Configuration 側の検査へ移す。
--    競合・依存・注文範囲・単一選択の検証と、分類表の対象外カテゴリーの必須判定は従来どおり。
--
-- 2. 既存 non-draft 履歴の正当な status transition を妨げない
--    直前 corrective の検査は status が変わるたびに現在の分類表で明細を再検証するため、
--    × になった商品を含む履歴（例: Wing / office / quoted / door-standard）が closed へ進めない。

-- ---------- preflight / fail closed ----------

do $$
begin
  if to_regprocedure('public.customer_business_item_for_category(text)') is null
     or to_regprocedure('public.customer_product_spec_selectable(text,text,text[])') is null
     or to_regprocedure('public.customer_category_selectable(text,text,text)') is null
     or to_regprocedure('public.enforce_configuration_customer_categories()') is null
     or to_regprocedure('public.validate_configuration_items(uuid,uuid[],text)') is null
  then
    raise exception 'PRECONDITION: preceding customer-spec correctives are not applied';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.configurations'::regclass
       and tgname = 'configurations_customer_category_guard'
       and not tgisinternal
  ) then
    raise exception 'PRECONDITION: configurations_customer_category_guard trigger is missing';
  end if;
end;
$$;

-- ---------- required validation ----------
create or replace function public.validate_configuration_items(
  p_model_id uuid,
  p_option_ids uuid[],
  p_finish_level text default 'full'
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_rank integer := public.finish_level_rank(p_finish_level);
begin
  for r in
    select c.option_id, c.conflicts_with_option_id, c.message from public.option_conflicts c
    where c.option_id = any (p_option_ids) and c.conflicts_with_option_id = any (p_option_ids)
  loop
    raise exception 'CONFLICT: %', coalesce(r.message, '同時に選択できないオプションが含まれています') using errcode = 'P0001';
  end loop;

  -- 依存ルールは候補の絞り込みに関係なく常に検証する（前提商品を選べない仕様では明示エラーになる）
  for r in
    select d.option_id, d.requires_option_id, d.message from public.option_dependencies d
    where d.option_id = any (p_option_ids) and not (d.requires_option_id = any (p_option_ids))
  loop
    raise exception 'DEPENDENCY: %', coalesce(r.message, '前提となるオプションが選択されていません') using errcode = 'P0001';
  end loop;

  -- 注文範囲外のカテゴリーの商品が混ざっていたら弾く（本体のみなのに内装が入っている等）
  for r in
    select cat.name from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where o.id = any (p_option_ids) and public.finish_level_rank(cat.finish_level) > v_rank
    group by cat.id, cat.name
  loop
    raise exception 'REQUIRED: 「%」は選択された注文範囲に含まれません', r.name using errcode = 'P0001';
  end loop;

  for r in
    select cat.name from public.option_categories cat
    where cat.status = 'published' and cat.is_required
      and public.customer_business_item_for_category(cat.code) is null
      and public.finish_level_rank(cat.finish_level) <= v_rank
      and exists (select 1 from public.options o where o.category_id = cat.id and o.status = 'published'
                  and (o.base_model_id is null or o.base_model_id = p_model_id))
      and not exists (select 1 from public.options o where o.category_id = cat.id and o.id = any (p_option_ids))
  loop
    raise exception 'REQUIRED: 「%」を選択してください', r.name using errcode = 'P0001';
  end loop;

  for r in
    select cat.name, count(*) as n from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where cat.selection_mode = 'single' and o.id = any (p_option_ids)
    group by cat.id, cat.name having count(*) > 1
  loop
    raise exception 'SINGLE: 「%」は 1 つだけ選択してください', r.name using errcode = 'P0001';
  end loop;
end;
$$;

alter function public.validate_configuration_items(uuid, uuid[], text) owner to postgres;

-- ---------- Configuration guard ----------
-- Configuration側のspec/model/statusだけを変更して既存itemsを不整合にする経路も、
-- transaction終端でfinal stateを検証して拒否する。save_configuration_atomicの
-- 「header更新→items入替」を妨げないようDEFERRABLEにする。
--
-- 検査の対象は「編集可能なDraft」と「Draftからの提出・モデル／仕様の変更」。
-- 既に non-draft の履歴（quote_requested / quoted / closed）は、現在の本体分類表で × になる商品を
-- 含んでいても保存内容を書き換えず、正当な status transition（例: 承諾時の closed）も妨げない。
create or replace function public.enforce_configuration_customer_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_slug text;
  v_bad record;
  v_missing text;
begin
  if new.status = 'draft' and new.spec_code is null then
    raise exception 'VALIDATION: 編集可能なConfigurationには仕様を指定してください'
      using errcode = 'P0001';
  end if;

  -- 既存 non-draft 履歴の status だけの遷移は、現在の本体分類表で再検証しない。
  -- モデル・仕様の変更を伴う場合は従来どおり検証する（fail closed）。
  if tg_op = 'UPDATE'
     and old.status <> 'draft'
     and new.status <> 'draft'
     and new.base_model_id is not distinct from old.base_model_id
     and new.spec_code is not distinct from old.spec_code then
    return new;
  end if;

  select m.slug into v_model_slug
    from public.base_models m
   where m.id = new.base_model_id;

  if v_model_slug is null then
    raise exception 'VALIDATION: Configurationのモデルを確認できません'
      using errcode = 'P0001';
  end if;

  select o.code as option_code, cat.code as category_code
    into v_bad
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = new.id
     and (
       (o.base_model_id is not null and o.base_model_id <> new.base_model_id)
       or not public.customer_product_spec_selectable(v_model_slug, new.spec_code, coalesce(o.spec_codes, '{}'::text[]))
       or not public.customer_category_selectable(v_model_slug, new.spec_code, cat.code)
     )
   limit 1;

  if found then
    raise exception 'VALIDATION: 選択中のモデル・仕様では選択できない商品 %（カテゴリー %）が含まれています',
      v_bad.option_code, v_bad.category_code
      using errcode = 'P0001';
  end if;

  -- 必須カテゴリーの判定を本体分類表と同じ正本で行う。
  -- 「選択」のカテゴリーで、そのモデル・仕様に適合する公開商品が1件以上ある場合だけ必須とする。
  -- × のカテゴリーと、適合商品が0件のカテゴリーは必須にしない（保存不能にしない）。
  -- 対象は編集可能なDraftの保存と、Draftからの提出。non-draft 履歴へは遡及しない。
  if new.spec_code is not null
     and (new.status = 'draft' or (tg_op = 'UPDATE' and old.status = 'draft')) then
    select cat.name
      into v_missing
      from public.option_categories cat
     where cat.status = 'published'
       and cat.is_required
       and public.customer_business_item_for_category(cat.code) is not null
       and public.finish_level_rank(cat.finish_level) <= public.finish_level_rank(new.finish_level)
       and public.customer_category_selectable(v_model_slug, new.spec_code, cat.code)
       and exists (
         select 1
           from public.options o
          where o.category_id = cat.id
            and o.status = 'published'
            and (o.base_model_id is null or o.base_model_id = new.base_model_id)
            and public.customer_product_spec_selectable(v_model_slug, new.spec_code, coalesce(o.spec_codes, '{}'::text[]))
       )
       and not exists (
         select 1
           from public.configuration_items ci
           join public.options o on o.id = ci.option_id
          where ci.configuration_id = new.id
            and o.category_id = cat.id
       )
     order by cat.sort_order, cat.code
     limit 1;

    if found then
      raise exception 'REQUIRED: 「%」を選択してください', v_missing
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

alter function public.enforce_configuration_customer_categories() owner to postgres;
revoke all on function public.enforce_configuration_customer_categories()
  from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.validate_configuration_items(uuid,uuid[],text)'::regprocedure,
       'public.enforce_configuration_customer_categories()'::regprocedure
     )
  loop
    if v_fn.owner <> 'postgres' or not v_fn.prosecdef or not ('search_path=""' = any(v_fn.proconfig)) then
      raise exception 'POSTCONDITION: % must be a postgres-owned SECURITY DEFINER function with an empty search_path', v_fn.signature;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.enforce_configuration_customer_categories()', 'execute')
     or has_function_privilege('authenticated', 'public.enforce_configuration_customer_categories()', 'execute')
  then
    raise exception 'POSTCONDITION: Configuration guard trigger function must not be executable by API roles';
  end if;
end;
$$;
