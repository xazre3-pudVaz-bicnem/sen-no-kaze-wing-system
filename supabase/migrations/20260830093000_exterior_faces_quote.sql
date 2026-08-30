-- =============================================================
-- 外壁4面を見積発行時の明細へ固定する
-- exterior_faces がある場合、従来の外壁1行は出さず、4面の仕様を0円の仕様行として保存する。
-- 金額計算は configurations の既存計算結果を使用し、4面化で金額を4倍にしない。
-- =============================================================

create or replace function public.create_quote_from_configuration(
  p_configuration_id uuid,
  p_contact jsonb,
  p_message text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cfg public.configurations;
  v_uid uuid := auth.uid();
  v_req uuid;
  v_quote uuid;
  v_no text;
  v_model public.base_models;
  v_opts uuid[];
  v_customer_no text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  select * into cfg from public.configurations where id=p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if cfg.user_id<>v_uid then raise exception 'FORBIDDEN' using errcode='42501'; end if;

  select coalesce(array_agg(option_id),'{}') into v_opts
    from public.configuration_items where configuration_id=cfg.id;
  perform public.validate_configuration_items(cfg.base_model_id,v_opts,cfg.finish_level);
  cfg:=public.recalculate_configuration(cfg.id);
  select * into v_model from public.base_models where id=cfg.base_model_id;
  select customer_no into v_customer_no from public.profiles where id=v_uid;

  insert into public.quote_requests(configuration_id,user_id,status,message,contact)
  values(cfg.id,v_uid,'new',p_message,coalesce(p_contact,'{}'::jsonb)) returning id into v_req;
  v_no:=public.next_quote_no();

  insert into public.quotes(
    quote_no,quote_request_id,configuration_id,user_id,status,issued_at,valid_until,
    customer_no,customer_name,customer_company,base_model_name,finish_level,
    base_price,base_expense,option_subtotal,option_expense,installation_subtotal,adjustment,
    subtotal,tax_rate,tax,total,preview_image_url,notes
  )
  values(
    v_no,v_req,cfg.id,v_uid,'issued',now(),now()+interval '30 days',
    v_customer_no,coalesce(p_contact->>'full_name',''),nullif(p_contact->>'company_name',''),v_model.name,cfg.finish_level,
    cfg.base_price,cfg.base_expense,cfg.option_subtotal,cfg.option_expense,cfg.installation_subtotal,cfg.adjustment,
    cfg.subtotal,0.10,cfg.tax,cfg.total,cfg.preview_image_url,
    '本見積書は概算です。別途工事（運送費・現地工事費等）は設置場所の確認後に確定します。'
  ) returning id into v_quote;

  insert into public.quote_items(quote_id,kind,name,description,unit_price,quantity,amount,sort_order)
  values
    (v_quote,'base',v_model.name||' 本体一式','工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）',v_model.base_price,1,v_model.base_price,0),
    (v_quote,'base_expense','本体諸費用','交通費、労災、安全管理費等（'||round(coalesce(v_model.expense_rate,0.15)*100)||'%）',cfg.base_expense,1,cfg.base_expense,1);

  -- 通常の選択商品。4面指定がある場合だけ、従来の外壁1行は除外する。
  insert into public.quote_items(quote_id,kind,name,description,unit_price,quantity,amount,image_url,sort_order)
  select
    v_quote,
    case when cat.code='free-product' then 'free' when o.is_installation then 'installation' else 'option' end,
    o.name||coalesce(v.label,''),
    case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
    case when o.price_on_request then 0 else o.price end+coalesce(v.extra,0),
    ci.quantity,
    (case when o.price_on_request then 0 else o.price end+coalesce(v.extra,0))*ci.quantity,
    o.image_url,
    20+row_number() over(order by o.is_installation,cat.sort_order,o.sort_order)
  from public.configuration_items ci
  join public.options o on o.id=ci.option_id
  join public.option_categories cat on cat.id=o.category_id
  left join lateral (
    select
      '（'||string_agg(vg.name||'：'||vc.name,'／' order by vg.sort_order,vc.sort_order)||'）' label,
      sum(case when vc.price_on_request then 0 else vc.extra_price end) extra
    from public.option_variant_choices vc
    join public.option_variant_groups vg on vg.id=vc.group_id
    where vc.id=any(ci.variant_choice_ids)
  ) v on true
  where ci.configuration_id=cfg.id
    and not (
      cat.code='exterior-wall'
      and jsonb_typeof(cfg.exterior_faces)='array'
      and jsonb_array_length(cfg.exterior_faces)=4
    );

  -- 4面の外壁仕様を発行時点の文字列として固定する。
  -- quote_items に保存するため、その後商品マスターの名称・色が変わっても発行済み見積は変わらない。
  if jsonb_typeof(cfg.exterior_faces)='array' and jsonb_array_length(cfg.exterior_faces)=4 then
    insert into public.quote_items(
      quote_id,kind,name,description,unit_price,quantity,unit,amount,image_url,remark,sort_order
    )
    select
      v_quote,
      'option',
      '外壁仕様（'||case f.face_code
        when 'front' then '正面'
        when 'right' then '右側面'
        when 'back' then '背面'
        when 'left' then '左側面'
        else f.face_code end||'）',
      o.name || case when coalesce(v.label,'')='' then '' else ' ／ '||v.label end,
      0,
      1,
      '面',
      0,
      o.image_url,
      '見積発行時点の面別外壁仕様',
      10 + case f.face_code when 'front' then 1 when 'right' then 2 when 'back' then 3 when 'left' then 4 else 9 end
    from (
      select
        value ->> 'face_code' as face_code,
        (value ->> 'option_id')::uuid as option_id,
        coalesce(value -> 'variant_choice_ids','[]'::jsonb) as variant_choice_ids
      from jsonb_array_elements(cfg.exterior_faces)
    ) f
    join public.options o on o.id=f.option_id
    left join lateral (
      select string_agg(vg.name||'：'||vc.name,'／' order by vg.sort_order,vc.sort_order) as label
      from jsonb_array_elements_text(f.variant_choice_ids) j(choice_id)
      join public.option_variant_choices vc on vc.id=j.choice_id::uuid
      join public.option_variant_groups vg on vg.id=vc.group_id
    ) v on true;
  end if;

  insert into public.quote_items(quote_id,kind,name,description,unit_price,quantity,amount,sort_order)
  values(v_quote,'option_expense','オプション諸費用','交通費、労災、安全管理費等（'||round(coalesce(v_model.expense_rate,0.15)*100)||'%）',cfg.option_expense,1,cfg.option_expense,9000);

  update public.quote_requests set quote_id=v_quote where id=v_req;
  update public.configurations set status='quote_requested' where id=cfg.id;
  insert into public.configuration_snapshots(configuration_id,reason,snapshot)
  values(cfg.id,'quote_requested',public.configuration_pricing_json(cfg.id));
  return v_quote;
end $$;

revoke all on function public.create_quote_from_configuration(uuid,jsonb,text) from public;
grant execute on function public.create_quote_from_configuration(uuid,jsonb,text) to authenticated;
