-- PR #389 独立再レビューで残った Configuration / hotel-single の hardening。
--
-- 20261006183000_customer_spec_category_applicability_corrective.sql は編集せず、
-- その直後に適用する追加correctiveとする。
-- 本番適用前は必ず全pending migrationのdry-runとread-only preflightを行う。

-- ---------- preflight / fail closed ----------

do $$
declare
  v_template public.estimate_templates%rowtype;
  v_expected_ids uuid[];
  v_actual_ids uuid[];
  v_filtered_total numeric;
begin
  if to_regprocedure('public.customer_product_spec_selectable(text,text,text[])') is null
     or to_regprocedure('public.customer_category_selectable(text,text,text)') is null
     or to_regprocedure('public.estimate_baseline_master_section_total(uuid,text)') is null
  then
    raise exception 'PRECONDITION: preceding customer-spec corrective is not applied';
  end if;

  -- 20260928100000_configuration_atomic_save_corrective が先に適用され、
  -- authenticatedの通常保存がatomic RPCだけへ閉じていることを要求する。
  if has_table_privilege('authenticated', 'public.configurations', 'INSERT')
     or has_table_privilege('authenticated', 'public.configurations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.configuration_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.configuration_items', 'UPDATE')
     or has_table_privilege('authenticated', 'public.configuration_items', 'DELETE')
  then
    raise exception 'PRECONDITION: Configuration direct-write ACL is not hardened; review migration order';
  end if;

  -- Standard Estimateが既に取り込まれている環境では、実テンプレートそのものを検算する。
  -- 未取込環境ではtemplate不在を許容し、取込後のruntime postflight対象とする。
  select t.*
    into v_template
    from public.estimate_templates t
    join public.base_models m on m.id = t.base_model_id
   where m.slug = 'box'
     and t.spec_code = 'hotel-single';

  if found then
    select array_agg(o.id order by o.id)
      into v_expected_ids
      from public.options o
     where o.code in (
       'interior-standard-box',
       'carpentry-box',
       'shower-unit-1116',
       'mini-kitchen',
       'folding-bed'
     );

    select array_agg(x.option_id order by x.option_id)
      into v_actual_ids
      from unnest(v_template.baseline_option_ids) as x(option_id);

    if v_actual_ids is distinct from v_expected_ids then
      raise exception 'PRECONDITION: BOX hotel-single baseline_option_ids do not match the audited five products';
    end if;

    if v_template.total <> 3812600 then
      raise exception 'PRECONDITION: BOX hotel-single Excel total changed; independent review required';
    end if;

    select sum(public.estimate_baseline_master_section_total(v_template.id, s.section_code))
      into v_filtered_total
      from unnest(array['interior_exterior','option','sitework']::text[]) as s(section_code);

    if coalesce(v_filtered_total, -1) <> 1518904 then
      raise exception 'PRECONDITION: BOX hotel-single filtered baseline master total is not 1,518,904 yen';
    end if;
  end if;
end;
$$;

-- ---------- hotel-single technical alias durability ----------
-- 管理画面の商品編集フォームはhotel / residence / officeのみを送るため、
-- residence商品を通常編集・保存してもtechnical aliasが脱落しないようDB側で保証する。
-- residenceを外した場合はフォーム入力どおりhotel-singleも送られないため、aliasは自然に外れる。

create or replace function public.ensure_hotel_single_spec_alias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.spec_codes := coalesce(new.spec_codes, '{}'::text[]);

  if 'residence' = any(new.spec_codes)
     and not ('hotel-single' = any(new.spec_codes))
  then
    new.spec_codes := array_append(new.spec_codes, 'hotel-single');
  end if;

  return new;
end;
$$;

alter function public.ensure_hotel_single_spec_alias() owner to postgres;
revoke all on function public.ensure_hotel_single_spec_alias()
  from public, anon, authenticated, service_role;

drop trigger if exists options_hotel_single_spec_alias_guard on public.options;
create trigger options_hotel_single_spec_alias_guard
before insert or update of spec_codes on public.options
for each row execute function public.ensure_hotel_single_spec_alias();

-- 直前correctiveで付与済みだが、再レビュー後の不変条件として既存行も再確認・補完する。
update public.options
   set spec_codes = array_append(spec_codes, 'hotel-single')
 where 'residence' = any(coalesce(spec_codes, '{}'::text[]))
   and not ('hotel-single' = any(coalesce(spec_codes, '{}'::text[]));

-- ---------- Configuration mutation / concurrency guard ----------
-- INSERT/UPDATE/DELETEすべてで親Configurationをrow lockし、Draft以外の履歴を変更させない。
-- save_configuration_atomic()は最初に同じ親行をFOR UPDATEしており、同一transaction内の再lockは安全。

create or replace function public.enforce_configuration_item_draft_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_configuration_id uuid;
  v_status text;
begin
  v_configuration_id := case when tg_op = 'DELETE' then old.configuration_id else new.configuration_id end;

  select cfg.status
    into v_status
    from public.configurations cfg
   where cfg.id = v_configuration_id
   for update of cfg;

  if not found then
    raise exception 'VALIDATION: Configurationを確認できません'
      using errcode = 'P0001';
  end if;

  if v_status <> 'draft' then
    raise exception 'LOCKED: Draft以外のConfiguration明細は変更できません'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function public.enforce_configuration_item_draft_parent() owner to postgres;
revoke all on function public.enforce_configuration_item_draft_parent()
  from public, anon, authenticated, service_role;

drop trigger if exists configuration_items_00_draft_parent_guard on public.configuration_items;
create trigger configuration_items_00_draft_parent_guard
before insert or update or delete on public.configuration_items
for each row execute function public.enforce_configuration_item_draft_parent();

-- 商品適合trigger自身も親行をlockして、親spec/model変更とitem書込みを直列化する。
create or replace function public.enforce_configuration_item_customer_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_id uuid;
  v_model_slug text;
  v_spec_code text;
  v_status text;
  v_category_code text;
  v_option_model_id uuid;
  v_option_spec_codes text[];
begin
  select m.id, m.slug, cfg.spec_code, cfg.status, cat.code, o.base_model_id, coalesce(o.spec_codes, '{}'::text[])
    into v_model_id, v_model_slug, v_spec_code, v_status, v_category_code, v_option_model_id, v_option_spec_codes
    from public.configurations cfg
    join public.base_models m on m.id = cfg.base_model_id
    join public.options o on o.id = new.option_id
    join public.option_categories cat on cat.id = o.category_id
   where cfg.id = new.configuration_id
   for update of cfg;

  if not found then
    raise exception 'VALIDATION: Configurationまたは商品カテゴリーを確認できません'
      using errcode = 'P0001';
  end if;

  if v_status <> 'draft' then
    raise exception 'LOCKED: Draft以外のConfiguration明細は変更できません'
      using errcode = 'P0001';
  end if;

  if v_spec_code is null then
    raise exception 'VALIDATION: 編集可能なConfigurationには仕様を指定してください'
      using errcode = 'P0001';
  end if;

  if v_option_model_id is not null and v_option_model_id <> v_model_id then
    raise exception 'VALIDATION: この商品は選択中のモデルでは使用できません'
      using errcode = 'P0001';
  end if;

  if not public.customer_product_spec_selectable(v_model_slug, v_spec_code, v_option_spec_codes) then
    raise exception 'VALIDATION: この商品は選択中の仕様では使用できません'
      using errcode = 'P0001';
  end if;

  if not public.customer_category_selectable(v_model_slug, v_spec_code, v_category_code) then
    raise exception 'VALIDATION: このモデル・仕様ではカテゴリー「%」を選択できません', v_category_code
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter function public.enforce_configuration_item_customer_category() owner to postgres;
revoke all on function public.enforce_configuration_item_customer_category()
  from public, anon, authenticated, service_role;

-- ---------- DB-level read-only history ----------
-- 通常の保存はatomic SECURITY DEFINER RPCへ限定済み。RLSもDraftだけに絞り、
-- 将来table privilegeが再付与されてもnon-draft履歴を直接変更できないよう防御を重ねる。

revoke insert, update, truncate on public.configurations from anon, authenticated;
revoke insert, update, delete, truncate on public.configuration_items from anon, authenticated;

drop policy if exists configurations_update on public.configurations;
create policy configurations_update on public.configurations
for update
using (
  status = 'draft'
  and (user_id = auth.uid() or public.is_admin())
)
with check (
  status = 'draft'
  and (user_id = auth.uid() or public.is_admin())
);

drop policy if exists configurations_delete on public.configurations;
create policy configurations_delete on public.configurations
for delete
using (
  status = 'draft'
  and (user_id = auth.uid() or public.is_admin())
);

drop policy if exists configuration_items_write on public.configuration_items;
create policy configuration_items_write on public.configuration_items
for all
using (
  exists (
    select 1
      from public.configurations c
     where c.id = configuration_items.configuration_id
       and c.status = 'draft'
       and (c.user_id = auth.uid() or public.is_admin())
  )
)
with check (
  exists (
    select 1
      from public.configurations c
     where c.id = configuration_items.configuration_id
       and c.status = 'draft'
       and (c.user_id = auth.uid() or public.is_admin())
  )
);

-- ---------- postconditions ----------

do $$
declare
  v_template public.estimate_templates%rowtype;
  v_expected_ids uuid[];
  v_actual_ids uuid[];
  v_filtered_total numeric;
begin
  if exists (
    select 1
      from public.options
     where 'residence' = any(coalesce(spec_codes, '{}'::text[]))
       and not ('hotel-single' = any(coalesce(spec_codes, '{}'::text[])))
  ) then
    raise exception 'POSTCONDITION: residence product lost hotel-single technical alias';
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.options'::regclass
       and tgname = 'options_hotel_single_spec_alias_guard'
       and not tgisinternal
  ) then
    raise exception 'POSTCONDITION: hotel-single alias trigger is missing';
  end if;

  if has_table_privilege('authenticated', 'public.configurations', 'INSERT')
     or has_table_privilege('authenticated', 'public.configurations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.configurations', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.configuration_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.configuration_items', 'UPDATE')
     or has_table_privilege('authenticated', 'public.configuration_items', 'DELETE')
     or has_table_privilege('authenticated', 'public.configuration_items', 'TRUNCATE')
  then
    raise exception 'POSTCONDITION: authenticated still has direct Configuration write privileges';
  end if;

  select t.*
    into v_template
    from public.estimate_templates t
    join public.base_models m on m.id = t.base_model_id
   where m.slug = 'box'
     and t.spec_code = 'hotel-single';

  if found then
    select array_agg(o.id order by o.id)
      into v_expected_ids
      from public.options o
     where o.code in (
       'interior-standard-box',
       'carpentry-box',
       'shower-unit-1116',
       'mini-kitchen',
       'folding-bed'
     );

    select array_agg(x.option_id order by x.option_id)
      into v_actual_ids
      from unnest(v_template.baseline_option_ids) as x(option_id);

    if v_actual_ids is distinct from v_expected_ids then
      raise exception 'POSTCONDITION: BOX hotel-single baseline_option_ids changed';
    end if;

    if v_template.total <> 3812600 then
      raise exception 'POSTCONDITION: BOX hotel-single Excel total is not 3,812,600 yen';
    end if;

    select sum(public.estimate_baseline_master_section_total(v_template.id, s.section_code))
      into v_filtered_total
      from unnest(array['interior_exterior','option','sitework']::text[]) as s(section_code);

    if coalesce(v_filtered_total, -1) <> 1518904 then
      raise exception 'POSTCONDITION: BOX hotel-single filtered baseline master total is not 1,518,904 yen';
    end if;
  end if;
end;
$$;
