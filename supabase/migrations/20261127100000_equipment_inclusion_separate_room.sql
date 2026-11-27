-- 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリーの二重の選択・二重の請求を DB で防ぎ、「別室に追加」の印を持てるようにする
-- （2026-11-12 の統合報告 6 章の設計案。2026-11-12 の先方の一括回答 3「A 案『別室に追加する』で確定・重複登録と二重請求は DB でも防ぐ・
--   標準と発行済みの写しは直接変えない・部屋のマスターは増やさない」、2026-11-24 の統合回答「確定済みの A 案を維持」、
--   2026-11-25 に承認された工程表の P5）
--
-- 決まり（新しく決めたものは無い。上の確定事項に合わせる）：
-- * 包含の関係は option_included_categories（#628。浴室（ub）の商品 → トイレ・洗面のカテゴリー）。この migration では変えない
-- * 保存したプランの明細（configuration_items）に「別室に追加」の印（separate_room）を足す。印はカテゴリー単位の明細だけ・トイレ・洗面の商品だけ
-- * 包含元（例：3 点ユニット）を選んでいるのに、含まれるカテゴリー（トイレ・洗面）の商品を印なしで選んでいたら、保存と見積依頼で止める
--   （validate_configuration_items に足す。保存（save_configuration_atomic）と見積依頼（create_quote_from_configuration）の両方が通る）
-- * 金額は変えない：含まれるカテゴリーの商品を選ばなければ、今の計算（旧来の「選んだ商品 − 標準」・v2.5 の「選んだ商品の売価 − 版の枠の売価」）
--   で標準の単体の商品の分が「選択商品の変更差額」から外れる。別室に追加した明細は、普通の明細として計上される（同じ商品の 2 行も 2 つ数える）
-- * 見積の写し：ユニットに含まれるカテゴリーに 0 円の注記、別室に追加した明細に 0 円の写し（明細を 1 行ずつ写す旧仕様は、商品名に「（別室）」）
-- * 標準見積の版：包含元の標準と、含まれるカテゴリーの単体の標準を同じ版に置けない（公開の決まりに足す。版の「別室」の印は作らない）
-- * 公開済みの版・発行済みの見積・既存のプランの明細は変えない（既存の明細はすべて印なし）。既存のプランの重複は、開き直して保存するときに止まる
--
-- 既存の関数は、目印を確かめて差し込む。保存の関数は引数を足すため、今の定義（pg_get_functiondef）を土台に作り直し、権限を付け直す
begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regclass('public.configuration_items') is null
     or to_regclass('public.option_included_categories') is null
     or to_regclass('public.configuration_items_option_key') is null
     or to_regprocedure('public.validate_configuration_items(uuid, uuid[], text, uuid[])') is null
     or to_regprocedure('public.validate_configuration_items(uuid, uuid[], text)') is null
     or to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)') is null
     or to_regprocedure('public.create_quote_from_configuration(uuid, jsonb, text, integer)') is null
     or to_regprocedure('public.duplicate_configuration(uuid)') is null
     or to_regprocedure('public.create_guest_plan(text, uuid, jsonb)') is null
     or to_regprocedure('public.standard_estimate_v25_slot_rule_issues(uuid)') is null
     or to_regprocedure('public.get_case_plan_configuration(uuid)') is null
     or to_regprocedure('public.estimate_section_for_option(text, boolean)') is null
     or to_regprocedure('public.simulator_standard_pricing_enabled()') is null
     or to_regprocedure('public.cf_uuid_array_valid(jsonb, integer)') is null then
    raise exception 'PRECONDITION: the configuration / inclusion foundation is missing';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.configuration_items'::regclass and a.attname = 'separate_room' and not a.attisdropped
  )
     or to_regprocedure('public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])') is not null
     or to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])') is not null
     or to_regprocedure('public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean)') is not null then
    raise exception 'PRECONDITION: separate-room objects already exist; do not overwrite';
  end if;
  -- 置き換える一意の条件が、今の形（カテゴリー単位の明細の商品が 1 回）であること
  if pg_catalog.pg_get_indexdef('public.configuration_items_option_key'::regclass)
     <> 'CREATE UNIQUE INDEX configuration_items_option_key ON public.configuration_items USING btree (configuration_id, option_id) WHERE (slot_code IS NULL)' then
    raise exception 'PRECONDITION: configuration_items_option_key differs from the reviewed definition';
  end if;
end;
$preflight$;

-- ---------- 明細の「別室に追加」の印 ----------

alter table public.configuration_items
  add column separate_room boolean not null default false;

comment on column public.configuration_items.separate_room is
  '「別室に追加」の印（#628 の続き・A 案）。ユニットに含まれるカテゴリー（トイレ・洗面）の商品を、ユニットとは別の部屋の追加の設備として選んだ明細。'
  'カテゴリー単位の明細だけ。保存は save_configuration_atomic だけ（直接の書き込みは不可のまま）';

-- 位置・用途の枠の明細（slot_code）には付けない
alter table public.configuration_items
  add constraint configuration_items_separate_room_category_level check (not separate_room or slot_code is null);

-- カテゴリー単位の明細は、同じ商品を「ユニットの外（印なし）」と「別室」で 1 回ずつ持てる（ユニットを替えて標準の単体に戻したときなど）
drop index public.configuration_items_option_key;
create unique index configuration_items_option_key
  on public.configuration_items (configuration_id, option_id, separate_room)
  where slot_code is null;

-- ---------- 商品の選び方の検査：ユニットに含まれるカテゴリー ----------

-- 5 引数：別室に追加した明細を別に受け取る。競合・前提・注文範囲・必須には入れ、「1 つだけ選択」には入れない
-- （ここまでの確かめは 4 引数の本体（20261102100000）と同じ）
create function public.validate_configuration_items(
  p_model_id uuid, p_option_ids uuid[], p_finish_level text, p_slot_option_ids uuid[], p_separate_room_option_ids uuid[]
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
  v_separate uuid[] := coalesce(p_separate_room_option_ids, '{}'::uuid[]);
  -- 印なしの選択（カテゴリー単位・位置の枠）。包含元はここから、含まれるカテゴリーの重複もここで見る
  v_unmarked uuid[] := coalesce(p_option_ids, '{}'::uuid[]) || coalesce(p_slot_option_ids, '{}'::uuid[]);
  -- 位置・用途の選択枠の商品（v2.5 PR-S1）と別室の明細。競合・前提・注文範囲・必須は、カテゴリー単位の選択と合わせて確かめる
  v_all uuid[] := coalesce(p_option_ids, '{}'::uuid[]) || coalesce(p_slot_option_ids, '{}'::uuid[]) || coalesce(p_separate_room_option_ids, '{}'::uuid[]);
begin
  for r in
    select c.option_id, c.conflicts_with_option_id, c.message from public.option_conflicts c
    where c.option_id = any (v_all) and c.conflicts_with_option_id = any (v_all)
  loop
    raise exception 'CONFLICT: %', coalesce(r.message, '同時に選択できないオプションが含まれています') using errcode = 'P0001';
  end loop;
  -- 依存ルールは候補の絞り込みに関係なく常に検証する（前提商品を選べない仕様では明示エラーになる）
  for r in
    select d.option_id, d.requires_option_id, d.message from public.option_dependencies d
    where d.option_id = any (v_all) and not (d.requires_option_id = any (v_all))
  loop
    raise exception 'DEPENDENCY: %', coalesce(r.message, '前提となるオプションが選択されていません') using errcode = 'P0001';
  end loop;
  -- 注文範囲外のカテゴリーの商品が混ざっていたら弾く（本体のみなのに内装が入っている等）
  for r in
    select cat.name from public.option_categories cat
    join public.options o on o.category_id = cat.id
    where o.id = any (v_all) and public.finish_level_rank(cat.finish_level) > v_rank
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
                  and o.archived_at is null and o.simulator_visible
                  and (o.base_model_id is null or o.base_model_id = p_model_id))
      and not exists (select 1 from public.options o where o.category_id = cat.id and o.id = any (v_all))
  loop
    raise exception 'REQUIRED: 「%」を選択してください', r.name using errcode = 'P0001';
  end loop;
  for r in
    select cat.name, count(*) as n from public.option_categories cat
    join public.options o on o.category_id = cat.id
    -- 「1 つだけ選択」はカテゴリー単位の選択だけ（位置・用途の枠は、枠ごとに 1 つを保存の関数で確かめる。別室の明細も数えない）
    where cat.selection_mode = 'single' and o.id = any (p_option_ids)
    group by cat.id, cat.name having count(*) > 1
  loop
    raise exception 'SINGLE: 「%」は 1 つだけ選択してください', r.name using errcode = 'P0001';
  end loop;
  -- 「別室に追加」の印は、ユニットに含まれるカテゴリーになりうるトイレ・洗面の商品だけ（#628 の包含先と同じ）
  for r in
    select o.name from public.options o
    join public.option_categories cat on cat.id = o.category_id
    where o.id = any (v_separate) and cat.code not in ('toilet', 'washbasin')
  loop
    raise exception 'VALIDATION: 「%」は別室に追加できません（別室に追加できるのはトイレ・洗面の商品です）', r.name using errcode = 'P0001';
  end loop;
  -- ユニットに含まれるカテゴリーの商品は、「別室に追加」の印が無ければ選べない（同じ設置先の二重の選択・二重の請求を防ぐ）
  for r in
    select tc.name as category_name, string_agg(distinct so.name, '・') as source_names
      from public.option_included_categories ic
      join public.options so on so.id = ic.option_id
      join public.option_categories tc on tc.id = ic.included_category_id
     where ic.option_id = any (v_unmarked)
       and exists (
         select 1 from public.options o
          where o.category_id = ic.included_category_id and o.id = any (v_unmarked)
       )
     group by tc.id, tc.name, tc.sort_order
     order by tc.sort_order, tc.name
  loop
    raise exception 'VALIDATION: 「%」は「%」に含まれています。別の部屋に追加する場合は「別室に追加する」から選んでください', r.category_name, r.source_names
      using errcode = 'P0001';
  end loop;
end;
$$;

-- 4 引数（これまでの呼び出し）は、別室の明細なしとして 5 引数を呼ぶ（包含の確かめも同じく通る）
create or replace function public.validate_configuration_items(p_model_id uuid, p_option_ids uuid[], p_finish_level text, p_slot_option_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.validate_configuration_items(p_model_id, p_option_ids, p_finish_level, p_slot_option_ids, '{}'::uuid[]);
end;
$$;

-- ---------- 保存：別室に追加した明細を受け取る（引数を足すため作り直す） ----------

do $p5_save$
declare
  v_old_sig constant text := 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)';
  v_new_sig constant text := 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])';
  v_oid oid := pg_catalog.to_regprocedure(v_old_sig);
  v_new_oid oid;
  v_def text;
  v_from text[];
  v_to text[];
  v_index integer;
  v_before text;
  v_after text;
begin
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''))
    into v_before
    from pg_catalog.pg_proc p where p.oid = v_oid;
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_from := array[
    -- 1. 引数を足す
    'p_slot_selections jsonb DEFAULT ''[]''::jsonb)',
    -- 2. 変数
    E'  v_missing text;\nbegin\n',
    -- 3. 別室の明細の形と商品の確かめ（バリエーションの重複の確かめの後）
    E'    raise exception ''VALIDATION: 同じバリエーションを複数回保存できません'' using errcode = ''P0001'';\n  end if;\n',
    -- 4. 選び方の検査に別室の明細を渡す
    $old4$  perform public.validate_configuration_items(p_base_model_id, v_options, v_level, v_slot_option_ids);$old4$,
    -- 5. 別室の商品のバリエーションも選べる
    $old5$        or not (vg.option_id = any(v_options))$old5$,
    -- 6. 別室の商品の必須のバリエーションも確かめる
    E'     where vg.option_id = any(v_options)\n       and vg.status = ''published''\n       and vg.is_required\n',
    -- 7. 別室の明細を入れる（カテゴリー単位の明細の後）
    E'    from unnest(v_options) input(option_id);\n'
  ];
  v_to := array[
    'p_slot_selections jsonb DEFAULT ''[]''::jsonb, p_separate_room_option_ids uuid[] DEFAULT ''{}''::uuid[])',
    E'  /* 「別室に追加」の明細（#628 の続き・A 案） */\n'
    || E'  v_separate uuid[] := coalesce(p_separate_room_option_ids, ''{}''::uuid[]);\n'
    || E'  v_variant_options uuid[];\n'
    || E'  v_missing text;\nbegin\n',
    E'    raise exception ''VALIDATION: 同じバリエーションを複数回保存できません'' using errcode = ''P0001'';\n  end if;\n'
    || E'  /* 「別室に追加」の明細（#628 の続き・A 案）：10 件まで・同じ商品は 1 回・選べる商品だけ。\n'
    || E'     どのカテゴリーで別室に追加できるか・ユニットに含まれるカテゴリーとの関係は validate_configuration_items で確かめる */\n'
    || E'  if cardinality(v_separate) > 10 then\n'
    || E'    raise exception ''VALIDATION: 別室に追加する設備は 10 件までです'' using errcode = ''P0001'';\n'
    || E'  end if;\n'
    || E'  if cardinality(v_separate) <> cardinality(array(select distinct unnest(v_separate))) then\n'
    || E'    raise exception ''VALIDATION: 別室に追加する同じ設備を複数回保存できません'' using errcode = ''P0001'';\n'
    || E'  end if;\n'
    || E'  if exists (\n'
    || E'    select 1\n'
    || E'      from unnest(v_separate) input(option_id)\n'
    || E'      left join public.options o on o.id = input.option_id\n'
    || E'      left join public.option_categories c on c.id = o.category_id\n'
    || E'     where o.id is null\n'
    || E'        or o.status <> ''published''\n'
    || E'        or (o.base_model_id is not null and o.base_model_id <> p_base_model_id)\n'
    || E'        or public.finish_level_rank(c.finish_level) > public.finish_level_rank(v_level)\n'
    || E'        or (p_spec_code is not null and cardinality(o.spec_codes) > 0 and not (p_spec_code = any(o.spec_codes)))\n'
    || E'  ) then\n'
    || E'    raise exception ''VALIDATION: 選択できないオプションが含まれています'' using errcode = ''P0001'';\n'
    || E'  end if;\n',
    E'  /* 別室に追加した明細も、競合・前提・注文範囲・必須を確かめ、ユニットに含まれるカテゴリーの二重の選択を止める（#628 の続き・A 案） */\n'
    || E'  v_variant_options := v_options || v_separate;\n'
    || E'  perform public.validate_configuration_items(p_base_model_id, v_options, v_level, v_slot_option_ids, v_separate);',
    $new5$        or not (vg.option_id = any(v_variant_options))$new5$,
    E'     where vg.option_id = any(v_variant_options)\n       and vg.status = ''published''\n       and vg.is_required\n',
    E'    from unnest(v_options) input(option_id);\n'
    || E'\n'
    || E'  /* 「別室に追加」の明細（#628 の続き・A 案）。選択肢は、その明細の商品の選択肢だけ\n'
    || E'     （同じ商品をユニットの外と別室の両方で選んだときは、同じ選択肢になる） */\n'
    || E'  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids, separate_room)\n'
    || E'  select v_id, input.option_id, 1,\n'
    || E'    coalesce((\n'
    || E'      select array_agg(vc.id order by vc.id)\n'
    || E'        from public.option_variant_choices vc\n'
    || E'        join public.option_variant_groups vg on vg.id = vc.group_id\n'
    || E'       where vc.id = any(v_variants) and vg.option_id = input.option_id\n'
    || E'    ), ''{}''::uuid[]),\n'
    || E'    true\n'
    || E'    from unnest(v_separate) input(option_id);\n'
  ];
  for v_index in 1 .. pg_catalog.array_length(v_from, 1) loop
    if (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_from[v_index], ''))) / pg_catalog.length(v_from[v_index]) <> 1 then
      raise exception 'PRECONDITION: save_configuration_atomic differs from the reviewed definition (anchor % is not unique)', v_index;
    end if;
    v_def := pg_catalog.replace(v_def, v_from[v_index], v_to[v_index]);
  end loop;

  execute 'drop function ' || v_old_sig;
  execute v_def;

  v_new_oid := pg_catalog.to_regprocedure(v_new_sig);
  if v_new_oid is null then
    raise exception 'POSTCONDITION: save_configuration_atomic with the separate-room argument was not created';
  end if;
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''))
    into v_after
    from pg_catalog.pg_proc p where p.oid = v_new_oid;
  if v_after is distinct from v_before then
    raise exception 'POSTCONDITION: owner / security definer / search_path of save_configuration_atomic changed (% -> %)', v_before, v_after;
  end if;
end;
$p5_save$;

-- ---------- 見積の写し：ユニットに含まれるカテゴリーの注記と、別室に追加した明細 ----------

-- 内部の部品（create_quote_from_configuration から呼ぶ）。金額は 0 円で、合計・差額は変えない
create function public.write_configuration_inclusion_quote_notes(p_configuration_id uuid, p_quote_id uuid, p_copy_separate_room boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $notes$
begin
  -- ユニットに含まれるカテゴリー（含まれるカテゴリーの商品を印なしで選んでいないもの）：0 円の注記
  insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
  select p_quote_id,
         case public.estimate_section_for_option(x.category_code, false)
           when 'interior_exterior' then 'interior_exterior' when 'sitework' then 'installation' else 'option' end,
         x.category_name || '（ユニットに含まれています）',
         '「' || x.source_names || '」に含まれています',
         '式',
         '単体の商品は選んでいません（二重に計上しません）',
         0, 1, 0,
         case public.estimate_section_for_option(x.category_code, false)
           when 'interior_exterior' then 1000 when 'sitework' then 3000 else 2000 end + 880 + x.n
    from (
      select tc.code as category_code, tc.name as category_name, string_agg(distinct so.name, '・') as source_names,
             (row_number() over (order by tc.sort_order, tc.code))::integer as n
        from public.configuration_items src
        join public.option_included_categories ic on ic.option_id = src.option_id
        join public.options so on so.id = src.option_id
        join public.option_categories tc on tc.id = ic.included_category_id
       where src.configuration_id = p_configuration_id
         and not src.separate_room
         and not exists (
           select 1
             from public.configuration_items ci
             join public.options o on o.id = ci.option_id
            where ci.configuration_id = p_configuration_id and not ci.separate_room and o.category_id = ic.included_category_id
         )
       group by tc.id, tc.code, tc.name, tc.sort_order
    ) x;

  -- 別室に追加した明細：0 円の写し（価格は選択商品の変更差額に反映。明細を 1 行ずつ写す旧仕様では写さない）
  if p_copy_separate_room then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order)
    select p_quote_id,
           case public.estimate_section_for_option(c.code, o.is_installation)
             when 'interior_exterior' then 'interior_exterior' when 'sitework' then 'installation' else 'option' end,
           c.name || '（別室）',
           o.name || coalesce(' ／ ' || vl.label, ''),
           '式',
           '別室に追加した設備（価格は選択商品の変更差額に反映）',
           0, ci.quantity, 0, o.image_url,
           case public.estimate_section_for_option(c.code, o.is_installation)
             when 'interior_exterior' then 1000 when 'sitework' then 3000 else 2000 end
             + 860 + (row_number() over (order by c.sort_order, o.sort_order, o.id))::integer
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
      join public.option_categories c on c.id = o.category_id
      left join lateral (
        select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as label
          from pg_catalog.unnest(coalesce(ci.variant_choice_ids, '{}'::uuid[])) as j(choice_id)
          join public.option_variant_choices vc on vc.id = j.choice_id
          join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
      ) vl on true
     where ci.configuration_id = p_configuration_id and ci.separate_room;
  end if;
end;
$notes$;

-- ---------- 既存の関数に、目印を確かめて差し込む ----------

-- 適用済みの定義（pg_get_functiondef）の目印がちょうど 1 か所あることを確かめてから置き換える。
-- 想定と違う定義なら何も変えずに止まる。所有者・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを確かめる
create function pg_temp.p5_patch_function(p_target regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $patch$
declare
  v_def text;
  v_count integer;
  v_before text;
  v_after text;
begin
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_before
    from pg_catalog.pg_proc p where p.oid = p_target;
  v_def := pg_catalog.pg_get_functiondef(p_target);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, p_old, ''))) / pg_catalog.length(p_old);
  if v_count <> 1 then
    raise exception 'PRECONDITION: the definition of % has % markers (expected 1)', p_target, v_count;
  end if;
  execute pg_catalog.replace(v_def, p_old, p_new);
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_after
    from pg_catalog.pg_proc p where p.oid = p_target;
  if v_after is distinct from v_before then
    raise exception 'POSTCONDITION: owner / security definer / search_path / ACL of % changed (% -> %)', p_target, v_before, v_after;
  end if;
end;
$patch$;

-- 見積依頼：別室に追加した明細を別に渡し、ユニットに含まれるカテゴリーの二重の選択を確かめる
select pg_temp.p5_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$  -- 位置・用途の選択枠の明細（slot_code）は「1 つだけ選択」の数に入れない（v2.5 PR-S1）
  perform public.validate_configuration_items(
    cfg.base_model_id,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is null), '{}'),
    cfg.finish_level,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is not null), '{}')
  );$old$,
  $new$  -- 位置・用途の選択枠の明細（slot_code）は「1 つだけ選択」の数に入れない（v2.5 PR-S1）。
  -- 「別室に追加」の明細は別に渡し、ユニットに含まれるカテゴリーの二重の選択を確かめる（#628 の続き・A 案）
  perform public.validate_configuration_items(
    cfg.base_model_id,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is null and not separate_room), '{}'),
    cfg.finish_level,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and slot_code is not null), '{}'),
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id and separate_room), '{}')
  );$new$
);

-- 見積依頼（標準見積の無い旧仕様）：明細を 1 行ずつ写すので、別室に追加した明細は商品名に「（別室）」を付ける
select pg_temp.p5_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$      o.name || coalesce(v.label, ''),$old$,
  $new$      o.name || coalesce(v.label, '') || case when ci.separate_room then '（別室）' else '' end,$new$
);

-- 見積依頼：どの作り方でも最後に、ユニットに含まれるカテゴリーの注記と、別室に追加した明細の 0 円の写しを残す
-- （明細を 1 行ずつ写す旧仕様（標準見積なし）は、別室の明細が価格つきで並ぶので写さない）。
-- どの作り方を通ったかは、条件を計算し直さず、実際に通った分岐で記録する（v2.5 の写しの関数が将来変わっても食い違わない）
select pg_temp.p5_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$  v_template public.estimate_templates;$old$,
  $new$  v_template public.estimate_templates;
  -- 明細を 1 行ずつ写す旧仕様の分岐を通ったか（#628 の続き・A 案）
  v_per_line_copy boolean := false;$new$
);
select pg_temp.p5_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$  if public.write_standard_estimate_quote_items(cfg.id, v_quote) then
    null;
  elsif v_template.id is null then
$old$,
  $new$  if public.write_standard_estimate_quote_items(cfg.id, v_quote) then
    null;
  elsif v_template.id is null then
    v_per_line_copy := true;
$new$
);
select pg_temp.p5_patch_function(
  'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure,
  $old$  update public.quote_requests set quote_id = v_quote where id = v_req;$old$,
  $new$  -- 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリーの 0 円の注記と、別室に追加した明細の 0 円の写し
  perform public.write_configuration_inclusion_quote_notes(cfg.id, v_quote, not v_per_line_copy);
  update public.quote_requests set quote_id = v_quote where id = v_req;$new$
);

-- プランの複製：別室の印も写す（写さないと、複製したプランがユニットに含まれるカテゴリーの二重の選択になる）
select pg_temp.p5_patch_function(
  'public.duplicate_configuration(uuid)'::regprocedure,
  $old$  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids, slot_code)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids, ci.slot_code
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;$old$,
  $new$  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids, slot_code, separate_room)
  select v_id, ci.option_id, ci.quantity, ci.variant_choice_ids, ci.slot_code, ci.separate_room
    from public.configuration_items ci
   where ci.configuration_id = p_configuration_id;$new$
);

-- ログインなしの一時保存：別室に追加した明細も持てるようにする（形だけ確かめる。中身はログインして保存するとき）
select pg_temp.p5_patch_function(
  'public.create_guest_plan(text, uuid, jsonb)'::regprocedure,
  $old$     where k not in ('name', 'option_ids', 'variant_choice_ids', 'exterior_faces', 'finish_level', 'spec_code',
                     'site_prefecture', 'site_municipality', 'site_location_undecided', 'slot_selections')$old$,
  $new$     where k not in ('name', 'option_ids', 'variant_choice_ids', 'exterior_faces', 'finish_level', 'spec_code',
                     'site_prefecture', 'site_municipality', 'site_location_undecided', 'slot_selections',
                     'separate_room_option_ids')$new$
);
select pg_temp.p5_patch_function(
  'public.create_guest_plan(text, uuid, jsonb)'::regprocedure,
  $old$  if coalesce(p_plan ->> 'finish_level', 'full') not in ('shell', 'equipment', 'full')$old$,
  $new$  -- 「別室に追加」の明細（#628 の続き・A 案）。中身の確かめは、ログインして保存するとき（save_configuration_atomic）に行う
  if p_plan ? 'separate_room_option_ids' and jsonb_typeof(p_plan -> 'separate_room_option_ids') <> 'null'
     and not public.cf_uuid_array_valid(p_plan -> 'separate_room_option_ids', 10) then
    raise exception 'VALIDATION: 別室に追加する設備の形式が正しくありません' using errcode = 'P0001';
  end if;
  if coalesce(p_plan ->> 'finish_level', 'full') not in ('shell', 'equipment', 'full')$new$
);

-- 標準見積の版の公開の決まり：包含元の標準と、含まれるカテゴリーの単体の標準を同じ版に置けない
select pg_temp.p5_patch_function(
  'public.standard_estimate_v25_slot_rule_issues(uuid)'::regprocedure,
  $old$    select bi.option_name_snapshot as name, bi.quantity, bi.slot_code, bi.slot_label, bi.unit_snapshot, o.spec_codes,$old$,
  $new$    select bi.option_id, bi.option_name_snapshot as name, bi.quantity, bi.slot_code, bi.slot_label, bi.unit_snapshot, o.spec_codes,$new$
);
select pg_temp.p5_patch_function(
  'public.standard_estimate_v25_slot_rule_issues(uuid)'::regprocedure,
  -- 目印は、最後の判定の終わりと、全体の閉じ（片側だけの括弧を含むので、単一引用符の文字列で書く）
  E'      where not public.customer_product_spec_selectable(rev.model_slug, rev.spec_code, x.spec_codes))\n  ), '''');',
  -- 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリー（トイレ・洗面）の単体の商品を、そのユニットと同じ版の標準に置かない
  -- （二重の計上を防ぐ。版の「別室」の印はまだ無いので、別の部屋の設備を標準にするときはご相談）
  E'      where not public.customer_product_spec_selectable(rev.model_slug, rev.spec_code, x.spec_codes)),\n'
  || E'    /* 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリー（トイレ・洗面）の単体の商品を、そのユニットと同じ版の標準に置かない */\n'
  || E'    (select ''ユニットに含まれる設備と同じカテゴリーの単体の商品を、同じ版の標準にできません：''\n'
  || E'            || string_agg(distinct ''「'' || t.category_name || ''」は「'' || src.name || ''」に含まれています'', ''・'')\n'
  || E'       from slots src\n'
  || E'       join public.option_included_categories ic on ic.option_id = src.option_id\n'
  || E'       join slots t on t.category_id = ic.included_category_id)\n'
  || E'  ), '''');'
);

-- 案件のプランボード（本部・担当者の画面）：明細ごとに「別室」の印も返す（印なしの選択と分けて「別室」のタイルに出す）
select pg_temp.p5_patch_function(
  'public.get_case_plan_configuration(uuid)'::regprocedure,
  $old$'slot_code', ci.slot_code$old$,
  $new$'slot_code', ci.slot_code,
                          'separate_room', ci.separate_room$new$
);

drop function pg_temp.p5_patch_function(regprocedure, text, text);

-- ---------- 所有者と権限 ----------

alter function public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[]) owner to postgres;
alter function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[]) owner to postgres;
alter function public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean) owner to postgres;

-- 内部の部品は API のロールから実行できない
revoke all on function public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- 保存は、これまでと同じくログインした利用者だけ（作り直したので権限を付け直す）
revoke all on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])
  to authenticated;

-- ---------- postconditions ----------

do $postconditions$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.configuration_items'::regclass and a.attname = 'separate_room' and a.attnotnull and not a.attisdropped
  ) then
    raise exception 'POSTCONDITION: configuration_items.separate_room must exist and be not null';
  end if;
  if pg_catalog.pg_get_indexdef('public.configuration_items_option_key'::regclass)
     <> 'CREATE UNIQUE INDEX configuration_items_option_key ON public.configuration_items USING btree (configuration_id, option_id, separate_room) WHERE (slot_code IS NULL)' then
    raise exception 'POSTCONDITION: configuration_items_option_key must include separate_room';
  end if;
  if to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)') is not null then
    raise exception 'POSTCONDITION: the previous save_configuration_atomic signature must be dropped';
  end if;
  -- 内部の部品は API のロールから実行できない。保存はログインした利用者だけ
  if has_function_privilege('anon', 'public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])', 'EXECUTE')
     or has_function_privilege('service_role', 'public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.validate_configuration_items(uuid, uuid[], text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])', 'EXECUTE') then
    raise exception 'POSTCONDITION: function privileges are not as expected';
  end if;
  -- 既存の明細は変えていない（すべて印なし）
  if exists (select 1 from public.configuration_items where separate_room) then
    raise exception 'POSTCONDITION: existing configuration items must stay unmarked';
  end if;
end;
$postconditions$;

commit;
