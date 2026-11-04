-- =============================================================
-- v2.5 PR-S2b：案件の画面のプランボード（本部・担当の代理店）に、位置・用途の選択枠ごとの商品を出す
-- =============================================================
-- これまで：案件のプランボードの読み取り（get_case_plan_configuration）は、明細の位置（configuration_items.slot_code）を返さず、
-- 位置の枠の商品をカテゴリーのまとまりで出していた（見積書の明細は位置ごと。S2 の残り）。
-- 今回：
-- * 明細ごとに位置（slot_code）を返す
-- * 見積に固定した標準見積の版（quotes.standard_estimate_revision_id。v2.5 PR-D1）の位置の枠（名前・カテゴリー・標準の商品と選択肢）を返す
--   （v2.5 の見積でなければ空。権限の確認・ほかの返す値は今のまま）
-- * データは変えない。スイッチは入れない（関数 1 本に目印を確かめて差し込むだけ）
-- 既存 migration は編集しない。
-- =============================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.get_case_plan_configuration(uuid)') is null then
    raise exception 'PRECONDITION: get_case_plan_configuration(uuid) was not found';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.configuration_items'::regclass and attname = 'slot_code' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.quotes'::regclass and attname = 'standard_estimate_revision_id' and not attisdropped) then
    raise exception 'PRECONDITION: v2.5 position slots (20261102100000) and formal quotes (20261102120000) must be applied first';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.get_case_plan_configuration(uuid)'::regprocedure), '''position_slots''') > 0 then
    raise exception 'PRECONDITION: get_case_plan_configuration already returns position slots';
  end if;
end;
$preflight$;

create function pg_temp.s2b_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- 明細ごとの位置（カテゴリー単位の明細は null）
select pg_temp.s2b_patch_function(
  'public.get_case_plan_configuration(uuid)'::regprocedure,
  $old$'variant_choice_ids', ci.variant_choice_ids$old$,
  $new$'variant_choice_ids', ci.variant_choice_ids,
                          'slot_code', ci.slot_code$new$
);

-- 見積に固定した版の位置の枠（v2.5 の見積でなければ空）
select pg_temp.s2b_patch_function(
  'public.get_case_plan_configuration(uuid)'::regprocedure,
  $old$'exterior_faces', coalesce(c.exterior_faces, '[]'::jsonb)$old$,
  $new$'exterior_faces', coalesce(c.exterior_faces, '[]'::jsonb),
           -- 見積に固定した標準見積の版の位置・用途の選択枠（v2.5 PR-S2b。v2.5 の見積でなければ空）
           'position_slots', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'slot_code', bi.slot_code,
                        'slot_label', bi.slot_label,
                        'section_code', bi.section_code,
                        'category_id', bi.option_category_id,
                        'standard_option_id', bi.option_id,
                        'standard_variant_choice_ids', coalesce((
                          select jsonb_agg(bv.variant_choice_id order by bv.variant_choice_id)
                            from public.standard_estimate_revision_baseline_variants bv
                           where bv.baseline_item_id = bi.id), '[]'::jsonb)
                      )
                      order by bi.sort_order, bi.id
                    )
               from public.standard_estimate_revision_baseline_items bi
              where bi.revision_id = v_quote.standard_estimate_revision_id
                and bi.slot_code is not null
           ), '[]'::jsonb)$new$
);

drop function pg_temp.s2b_patch_function(regprocedure, text, text);

-- ---------- postconditions ----------

do $postconditions$
declare
  v_def text := pg_catalog.pg_get_functiondef('public.get_case_plan_configuration(uuid)'::regprocedure);
begin
  if pg_catalog.strpos(v_def, '''slot_code'', ci.slot_code') = 0 or pg_catalog.strpos(v_def, '''position_slots''') = 0 then
    raise exception 'POSTCONDITION: get_case_plan_configuration was not patched';
  end if;
  if has_function_privilege('anon', 'public.get_case_plan_configuration(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_case_plan_configuration(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: get_case_plan_configuration privileges changed';
  end if;
end;
$postconditions$;

commit;
