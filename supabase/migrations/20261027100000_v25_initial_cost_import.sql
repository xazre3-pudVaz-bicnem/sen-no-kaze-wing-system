-- v2.5 PR-A3：既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む（本部が確認した一覧だけ）。
--
-- 2026-10-27 先方方針：
-- * 商品本体は「商品標準原価（税別）」、選択肢は標準仕様からの「原価差額（税別）」を登録する（千の風の調達想定の購入金額）
-- * 今の商品価格（options.price）と選択肢の追加金額（option_variant_choices.extra_price）は、千の風が原価として入力している。
--   これを初期の原価 Version へ引き継ぐ。旧シミュレーターは今の列を売価として使うので、列の意味・値は変えない
-- * 一括の取り込みは、内容を確認してから行う → この migration はデータを変えない。
--   取り込みは本部が画面で一覧（対象・除外の理由・金額）を確かめ、確かめた金額つきで渡して実行する
--
-- 取り込みの決まり（画面の一覧と同じ）
-- * 対象は登録済み（公開中）の商品と、その選択肢だけ。下書きの商品は、登録（STEP 2 の公開）のときに Version を作る
-- * 本部標準原価は本部商品だけ。本部商品の外（旧フリー商品＝代理店が登録した商品）は取り込まない（2026-10-29 先方の回答）
-- * 商品：別途見積は取り込まない。0 円・未設定は取り込まない（価格未確認の 0 円と区別できないため。一覧で別に確認する）
-- * 選択肢：別途見積は取り込まない。0 円は「標準と同じ（差額 0 円）」として取り込む（v2.5 は Version の無い選択肢を原価未設定として扱う）
-- * 確かめた後に金額が変わっていたら止める（後勝ちにしない）。同じ金額の Version がすでにあれば何も作らない
-- * Version の作り方・権限・監査は既存の RPC（set_option_hq_standard_cost・set_option_variant_cost_adjustment）に任せる
--
-- 既存 migration は編集しない。

begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.option_standard_cost_versions') is null
     or to_regclass('public.option_variant_cost_versions') is null
     or to_regprocedure('public.set_option_hq_standard_cost(uuid, integer, integer, text)') is null
     or to_regprocedure('public.set_option_variant_cost_adjustment(uuid, integer, uuid, text)') is null
     or to_regprocedure('public.option_variant_cost_min_total(uuid, uuid, integer)') is null then
    raise exception 'PRECONDITION: standard cost versions (20261016200000) must be applied first';
  end if;
  if to_regprocedure('public.import_option_standard_costs(jsonb, text)') is not null then
    raise exception 'PRECONDITION: import_option_standard_costs already exists';
  end if;
end;
$preflight$;

create function public.import_option_standard_costs(p_items jsonb, p_change_reason text)
returns table (kind text, target_id uuid, result text, version_no integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := pg_catalog.btrim(coalesce(p_change_reason, ''));
  v_count integer;
  v_option_ids uuid[];
  v_row record;
  v_item jsonb;
  v_id uuid;
  v_amount integer;
  v_option public.options%rowtype;
  v_choice record;
  v_copy_lock integer;
  v_current_id uuid;
  v_current_amount integer;
  v_min bigint;
  v_version integer;
  v_category_code text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.can_manage_option_hq_standard_cost() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 原価の取り込みは本部だけが行えます';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 取り込む一覧がありません';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count < 1 or v_count > 5000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 一度に取り込めるのは 1〜5,000 件です';
  end if;
  if pg_catalog.char_length(v_reason) < 1 or pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 取り込みの理由は1〜500文字で入力してください';
  end if;
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_items) e
     where pg_catalog.jsonb_typeof(e) <> 'object'
        or coalesce(e ->> 'kind', '') not in ('option', 'choice')
        or coalesce(e ->> 'id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or pg_catalog.jsonb_typeof(e -> 'amount') is distinct from 'number'
        or (e ->> 'amount') !~ '^-?[0-9]+$'
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 取り込む一覧の形式が正しくありません';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_items) e)
     <> (select count(distinct (e ->> 'kind', lower(e ->> 'id'))) from pg_catalog.jsonb_array_elements(p_items) e) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 同じ商品・選択肢が一覧に 2 回あります';
  end if;

  -- 商品の行を id の順に先に lock する（原価の RPC・商品の削除と同じ順。選択肢は所属の商品の行）
  select coalesce(pg_catalog.array_agg(distinct s.option_id order by s.option_id), '{}')
    into v_option_ids
    from (
      select (e ->> 'id')::uuid as option_id
        from pg_catalog.jsonb_array_elements(p_items) e
       where e ->> 'kind' = 'option'
      union
      select vg.option_id
        from pg_catalog.jsonb_array_elements(p_items) e
        join public.option_variant_choices vc on vc.id = (e ->> 'id')::uuid
        join public.option_variant_groups vg on vg.id = vc.group_id
       where e ->> 'kind' = 'choice'
    ) s;
  perform 1 from public.options o where o.id = any(v_option_ids) order by o.id for update;

  -- 取り込んだ後に、どの選び方でも原価が 0 円未満になる商品が無いかを先に確かめる（商品名つきで止める）。
  -- 商品の原価は「今回取り込む金額、無ければ今の Version」。どちらも無い商品は確かめない（既存の RPC と同じ）。
  -- 選択肢は「今回取り込む金額、無ければ今の Version、どちらも無ければ 0 円」の、選択項目ごとの最も低い額を足す
  select s.name
    into v_choice
    from (
      select o.id,
             o.name,
             coalesce(px.amount, cur_p.standard_cost) as product_cost,
             (select coalesce(sum(g.min_adjustment), 0)
                from (
                  select least(min(coalesce(ix.amount, cur.cost_adjustment, 0)), 0) as min_adjustment
                    from public.option_variant_groups vg
                    join public.option_variant_choices vc on vc.group_id = vg.id
                    left join lateral (
                      select (e ->> 'amount')::integer as amount
                        from pg_catalog.jsonb_array_elements(p_items) e
                       where e ->> 'kind' = 'choice' and (e ->> 'id')::uuid = vc.id
                    ) ix on true
                    left join public.option_variant_cost_versions cur
                      on cur.variant_choice_id = vc.id and cur.superseded_at is null
                   where vg.option_id = o.id
                   group by vg.id
                ) g) as min_total
        from public.options o
        left join lateral (
          select (e ->> 'amount')::integer as amount
            from pg_catalog.jsonb_array_elements(p_items) e
           where e ->> 'kind' = 'option' and (e ->> 'id')::uuid = o.id
        ) px on true
        left join public.option_standard_cost_versions cur_p
          on cur_p.option_id = o.id and cur_p.superseded_at is null
       where o.id = any(v_option_ids)
    ) s
   where s.product_cost is not null
     and s.product_cost + s.min_total < 0
   order by s.id
   limit 1;
  if found then
    raise exception using errcode = 'P0001',
      message = pg_catalog.format('VALIDATION: 「%s」は選択肢の原価差額を足すと 0 円未満になる組み合わせがあります。この商品を外して取り込んでください', v_choice.name);
  end if;

  -- 1 本の loop で、途中の状態でも原価が 0 円未満にならない順に記録する（既存の RPC は 1 件ごとに、その時点の版で確かめるため）
  --   1. 選択肢の原価差額のうち、今の版より上がる・同じもの（版が無ければ 0 円と比べる）
  --   2. 商品の標準原価
  --   3. 選択肢の原価差額のうち、今の版より下がるもの
  -- 最後の状態は上の事前の確認で 0 円以上と分かっているので、この順なら途中の状態も 0 円以上のまま
  for v_row in
    select e,
           case
             when e ->> 'kind' = 'option' then 2
             when (e ->> 'amount')::integer >= coalesce(cur.cost_adjustment, 0) then 1
             else 3
           end as phase
      from pg_catalog.jsonb_array_elements(p_items) e
      left join public.option_variant_cost_versions cur
        on e ->> 'kind' = 'choice'
       and cur.variant_choice_id = (e ->> 'id')::uuid
       and cur.superseded_at is null
     order by 2, (e ->> 'id')::uuid
  loop
    v_item := v_row.e;
    v_id := (v_item ->> 'id')::uuid;
    v_amount := (v_item ->> 'amount')::integer;

    if v_item ->> 'kind' = 'option' then
      -- 商品の標準原価
      select * into v_option from public.options o where o.id = v_id;
      if not found then
        raise exception using errcode = 'P0002', message = 'NOT_FOUND: 一覧の商品が見つかりません。一覧を開き直してください';
      end if;
      if v_option.status <> 'published' then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('VALIDATION: 「%s」は登録済みではありません（下書きは登録のときに原価を記録します）', v_option.name);
      end if;
      select c.code into v_category_code from public.option_categories c where c.id = v_option.category_id;
      if v_category_code is not distinct from 'free-product' then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('VALIDATION: 「%s」は本部商品ではないため取り込みません（本部標準原価は本部商品だけ）', v_option.name);
      end if;
      if v_option.price_on_request then
        raise exception using errcode = 'P0001', message = pg_catalog.format('VALIDATION: 「%s」は別途見積のため取り込みません', v_option.name);
      end if;
      if v_amount <= 0 then
        raise exception using errcode = 'P0001', message = pg_catalog.format('VALIDATION: 「%s」は 0 円・未設定のため取り込みません', v_option.name);
      end if;
      if v_option.price is distinct from v_amount then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('CONFLICT: 「%s」の金額が確認した後に変わりました。一覧を開き直してください', v_option.name);
      end if;

      select v.id, v.standard_cost, v.version_no into v_current_id, v_current_amount, v_version
        from public.option_standard_cost_versions v
       where v.option_id = v_id and v.superseded_at is null;
      if v_current_id is not null and v_current_amount = v_amount then
        kind := 'option'; target_id := v_id; result := 'unchanged'; version_no := v_version;
        return next;
        continue;
      end if;

      select c.lock_version into v_copy_lock from public.option_hq_standard_costs c where c.option_id = v_id;
      perform 1 from public.set_option_hq_standard_cost(v_id, v_amount, coalesce(v_copy_lock, 0), v_reason);
      select v.version_no into v_version
        from public.option_standard_cost_versions v
       where v.option_id = v_id and v.superseded_at is null;
      kind := 'option'; target_id := v_id; result := 'imported'; version_no := v_version;
      return next;
    else
      -- 選択肢の原価差額
      select vc.id, vc.name, vc.extra_price, vc.price_on_request, o.status, o.name as option_name, oc.code as category_code
        into v_choice
        from public.option_variant_choices vc
        join public.option_variant_groups vg on vg.id = vc.group_id
        join public.options o on o.id = vg.option_id
        left join public.option_categories oc on oc.id = o.category_id
       where vc.id = v_id;
      if not found then
        raise exception using errcode = 'P0002', message = 'NOT_FOUND: 一覧の選択肢が見つかりません。一覧を開き直してください';
      end if;
      if v_choice.status <> 'published' then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('VALIDATION: 「%s」の選択肢は、商品が登録済みではないため取り込みません', v_choice.option_name);
      end if;
      if v_choice.category_code is not distinct from 'free-product' then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('VALIDATION: 「%s」の選択肢は、本部商品ではないため取り込みません（本部標準原価は本部商品だけ）', v_choice.option_name);
      end if;
      if v_choice.price_on_request then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('VALIDATION: 「%s」の選択肢「%s」は別途見積のため取り込みません', v_choice.option_name, v_choice.name);
      end if;
      if v_choice.extra_price is distinct from v_amount then
        raise exception using errcode = 'P0001',
          message = pg_catalog.format('CONFLICT: 「%s」の選択肢「%s」の金額が確認した後に変わりました。一覧を開き直してください', v_choice.option_name, v_choice.name);
      end if;

      v_current_id := null;
      select v.id, v.cost_adjustment, v.version_no into v_current_id, v_current_amount, v_version
        from public.option_variant_cost_versions v
       where v.variant_choice_id = v_id and v.superseded_at is null;
      if v_current_id is not null and v_current_amount = v_amount then
        kind := 'choice'; target_id := v_id; result := 'unchanged'; version_no := v_version;
        return next;
        continue;
      end if;

      perform 1 from public.set_option_variant_cost_adjustment(v_id, v_amount, v_current_id, v_reason);
      select v.version_no into v_version
        from public.option_variant_cost_versions v
       where v.variant_choice_id = v_id and v.superseded_at is null;
      kind := 'choice'; target_id := v_id; result := 'imported'; version_no := v_version;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.import_option_standard_costs(jsonb, text) is
  '既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む（v2.5 PR-A3）。本部だけ。確認した金額（amount）と今の値が違えば止める。';

alter function public.import_option_standard_costs(jsonb, text) owner to postgres;
revoke all on function public.import_option_standard_costs(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.import_option_standard_costs(jsonb, text) to authenticated;

do $postflight$
declare
  v_fn record;
begin
  select p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) as owner_name, p.proconfig
    into v_fn
    from pg_catalog.pg_proc p
   where p.oid = to_regprocedure('public.import_option_standard_costs(jsonb, text)');
  if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres'
     or v_fn.proconfig is distinct from array['search_path=""'] then
    raise exception 'POSTCONDITION: import_option_standard_costs attributes are incorrect';
  end if;
  if has_function_privilege('anon', 'public.import_option_standard_costs(jsonb, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.import_option_standard_costs(jsonb, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.import_option_standard_costs(jsonb, text)', 'EXECUTE') then
    raise exception 'POSTCONDITION: import_option_standard_costs execution boundary is incorrect';
  end if;
end;
$postflight$;

commit;
