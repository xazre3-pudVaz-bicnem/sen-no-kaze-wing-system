-- =============================================================
-- v2.5 PR-D1c：Web 以外（対面・電話。本部だけ）の案件で、v2.5 の標準見積の版から見積下書きを作れるようにする
-- =============================================================
-- これまで：標準見積から作る見積（PR H）は v2.5 の版をまだ扱わず、DB で止めていた（quote_drafts_v25_standard_estimate_guard）。
-- 今回：
-- * v2.5 の版から作る下書きの明細を、版の選択枠（商品台帳の商品）と商品に紐づかない明細から作る
--   （standard_estimate_v25_quote_draft_lines）。本体の明細は今と同じ（固定した本体 Revision の基準原価）
--   - 選択枠（auto）：版で固定した原価単価（販売費率を掛けた後）を写し、売価 = trunc(原価単価 × 掛率)。版の売価と同じになる
--   - manual：版の売価。原価は版に無いため、売価と同じ（粗利 0）として写す（下書きで本部が直せる）
--   - por（別途見積）：por のまま（正式保存の前に金額・0円確定（理由）・対象外のどれかにする。今と同じ）
--   - 品名・見出しは Web の第 1 版の見積（write_standard_estimate_quote_items）と同じ（商品名 ／ 仕様、カテゴリー（位置））
--   率・経費の方法・調整額は今と同じく版から写す。同じ明細・率なら、下書きの合計は標準見積の版の合計と一致する
-- * 標準見積の版の 0 円の明細は、変えていなければ金額未確定として止めない（#529 の判定。v2.5 の版の明細でも同じに扱う）
-- * 発行・改訂は今の Web 以外の仕組み（本部だけ・率と内部原価は社内の記録・最新の標準見積へは追従しない）のまま
-- * スイッチは入れない。データは変えない（関数を 1 本足し、2 つの関数に目印を確かめて差し込み、v2.5 を止めていたトリガーを外す）
-- 既存 migration は編集しない。
-- =============================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)') is null then
    raise exception 'PRECONDITION: v2.5 formal quotes (20261102120000) must be applied first';
  end if;
  if to_regprocedure('public.materialize_standard_quote_draft(uuid, uuid)') is null
     or to_regprocedure('public.apply_standard_quote_draft(uuid, numeric, numeric, numeric, jsonb, jsonb, integer, text, text, boolean)') is null
     or to_regprocedure('public.assert_quote_draft_lines_resolved(uuid)') is null
     or to_regprocedure('public.quote_line_explicit_state(text)') is null
     or to_regprocedure('public.quote_line_por_marked(uuid, text, text)') is null then
    raise exception 'PRECONDITION: standard quote draft functions were not found';
  end if;
  if to_regprocedure('public.quote_drafts_v25_standard_estimate_guard()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.quote_drafts'::regclass and t.tgname = 'quote_drafts_v25_standard_estimate_guard'
                       and not t.tgisinternal) then
    raise exception 'PRECONDITION: the v2.5 quote draft guard is missing; review before applying';
  end if;
  if to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid)') is not null then
    raise exception 'PRECONDITION: v2.5 standard quote drafts already exist';
  end if;
end;
$preflight$;

-- ---------- v2.5 の版から、見積下書きの明細を作る（内部。API からは実行させない） ----------
-- 返す形は materialize_standard_quote_draft が apply_standard_quote_draft へ渡す明細と同じ
-- （section_code・name・description・unit・remark・quantity・price_mode・base_unit_cost・cost_unit_price・unit_price）。
-- v2.5 でない版は空の配列を返す（金額未確定の判定からも呼ぶため）

create function public.standard_estimate_v25_quote_draft_lines(p_revision_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $v25_draft_lines$
declare
  rev public.standard_estimate_revisions%rowtype;
  v_lines jsonb;
  v_names text;
begin
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id;
  if not found or rev.pricing_model is distinct from 'v2.5' then
    return '[]'::jsonb;
  end if;

  -- 公開した版の auto の選択枠は原価がそろっている（そろっていなければ、0 円にせず止める）
  select string_agg('「' || bi.option_name_snapshot || '」', '・' order by bi.sort_order, bi.id)
    into v_names
    from public.standard_estimate_revision_baseline_items bi
   where bi.revision_id = rev.id
     and (bi.price_mode is null or (bi.price_mode = 'auto' and bi.cost_unit_price is null));
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('LOCKED: 標準見積の版に、原価がそろっていない商品（%s）があります。標準見積の新しい版で最新原価を取り込んで公開してから作ってください', v_names);
  end if;

  with src as (
    -- 本体：固定した本体 Revision の基準原価（今の作り方と同じ）
    select 1 as section_rank, 0 as part, l.sort_order, l.id::text as id,
           pg_catalog.jsonb_build_object(
             'section_code', 'base', 'name', l.name, 'description', l.section, 'unit', l.unit, 'remark', l.remark,
             'quantity', l.quantity, 'price_mode', 'auto', 'base_unit_cost', l.unit_price
           ) as line
      from public.base_master_revision_lines l
     where l.revision_id = rev.base_master_revision_id
    union all
    -- 選択枠（商品台帳の商品）：品名は「商品名 ／ 仕様」、見出しは「カテゴリー（位置）」（Web の第 1 版の見積と同じ）
    select case bi.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end, 0, bi.sort_order, bi.id::text,
           pg_catalog.jsonb_build_object(
             'section_code', bi.section_code,
             'name', case when pg_catalog.char_length(n.full_name) > 120 then pg_catalog.left(n.full_name, 119) || '…' else n.full_name end,
             'description', case when bi.slot_label is null then bi.category_name_snapshot
                                 else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
             'unit', '式',
             'remark', null,
             'quantity', bi.quantity,
             'price_mode', bi.price_mode,
             -- auto は版で固定した原価単価（販売費率を掛けた後）。manual の原価は版に無いため売価と同じ（粗利 0）
             'cost_unit_price', case bi.price_mode when 'auto' then bi.cost_unit_price when 'manual' then bi.manual_unit_price end,
             'unit_price', case bi.price_mode when 'manual' then bi.manual_unit_price end
           )
      from public.standard_estimate_revision_baseline_items bi
     cross join lateral (
       select bi.option_name_snapshot || coalesce((
                select ' ／ ' || string_agg(bv.variant_choice_name_snapshot, '・' order by bv.sort_order)
                  from public.standard_estimate_revision_baseline_variants bv
                 where bv.baseline_item_id = bi.id), '') as full_name
     ) n
     where bi.revision_id = rev.id
    union all
    -- 商品に紐づかない明細（manual / por）。manual の原価は売価と同じ（粗利 0）
    select case l.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end, 1, l.sort_order, l.id::text,
           pg_catalog.jsonb_build_object(
             'section_code', l.section_code, 'name', l.name, 'description', l.group_label, 'unit', l.unit, 'remark', l.remark,
             'quantity', l.quantity, 'price_mode', l.price_mode,
             'cost_unit_price', case when l.price_mode = 'manual' then l.unit_price end,
             'unit_price', case when l.price_mode = 'manual' then l.unit_price end
           )
      from public.standard_estimate_revision_v25_lines l
     where l.revision_id = rev.id
  )
  select coalesce(pg_catalog.jsonb_agg(s.line order by s.section_rank, s.part, s.sort_order, s.id), '[]'::jsonb)
    into v_lines
    from src s;

  -- 見積の明細に入らない長さ（単位 12 文字・説明と備考 200 文字まで）は、行の番号ではなく明細の名前で知らせる
  select string_agg('「' || (x.value ->> 'name') || '」', '・')
    into v_names
    from pg_catalog.jsonb_array_elements(v_lines) x
   where pg_catalog.char_length(coalesce(x.value ->> 'unit', '')) > 12
      or pg_catalog.char_length(coalesce(x.value ->> 'description', '')) > 200
      or pg_catalog.char_length(coalesce(x.value ->> 'remark', '')) > 200;
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('VALIDATION: 標準見積の明細（%s）の単位（12 文字まで）・見出し（200 文字まで）・備考（200 文字まで）が見積の明細に入りません。標準見積の新しい版で直してから作ってください',
                       pg_catalog.left(v_names, 300));
  end if;

  return v_lines;
end;
$v25_draft_lines$;

comment on function public.standard_estimate_v25_quote_draft_lines(uuid) is
  'v2.5 の標準見積の版から、見積下書き（Web 以外）の明細を作る（本体は基準原価、選択枠は版で固定した原価単価、manual は版の売価で原価も同じ、por は por）。v2.5 でない版は空。内部用（v2.5 PR-D1c）。';

-- ---------- 既存の関数に、目印を確かめて差し込む（本体を丸ごと写さない。#529・S1・D1 と同じやり方） ----------

create function pg_temp.d1c_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- 下書きを作る：v2.5 の版は、版の選択枠と商品に紐づかない明細から明細を作る（率・経費の方法・調整額は今と同じく版から）
select pg_temp.d1c_patch_function(
  'public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure,
  $old$  -- 調整額・理由も入力値として写す（同じ明細・率なら、見積の合計は標準見積の合計と一致する）$old$,
  $new$  -- v2.5 の版は、版の選択枠（商品台帳の商品）と商品に紐づかない明細から明細を作る（本体は同じ。v2.5 PR-D1c）
  if rev.pricing_model = 'v2.5' then
    v_lines := public.standard_estimate_v25_quote_draft_lines(rev.id);
  end if;

  -- 調整額・理由も入力値として写す（同じ明細・率なら、見積の合計は標準見積の合計と一致する）$new$
);

-- 金額未確定の判定：v2.5 の版から作った初回の下書きも、版の 0 円の明細（別途見積でないもの）は変えていなければ止めない
select pg_temp.d1c_patch_function(
  'public.assert_quote_draft_lines_resolved(uuid)'::regprocedure,
  $old$     group by 2, btrim(s.name), btrim(coalesce(s.group_label, ''))$old$,
  $new$     group by 2, btrim(s.name), btrim(coalesce(s.group_label, ''))
    union all
    -- v2.5 の版（v2.5 PR-D1c）：版の明細から作った下書きの行と同じ品名・見出しで比べる
    select null::uuid,
           case x.value ->> 'section_code' when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' when 'sitework' then 'installation' end,
           btrim(x.value ->> 'name'), btrim(coalesce(x.value ->> 'description', '')), count(*)
      from pg_catalog.jsonb_array_elements(
             case when v_parent is null and v_standard is not null
                  then public.standard_estimate_v25_quote_draft_lines(v_standard) else '[]'::jsonb end) as x(value)
     where x.value ->> 'section_code' in ('interior_exterior', 'option', 'sitework')
       and ((x.value ->> 'price_mode' = 'auto' and coalesce((x.value ->> 'cost_unit_price')::integer, 0) = 0)
            or (x.value ->> 'price_mode' = 'manual' and coalesce((x.value ->> 'unit_price')::integer, 0) = 0))
       and public.quote_line_explicit_state(x.value ->> 'remark') is null
       and not public.quote_line_por_marked(null, x.value ->> 'description', x.value ->> 'remark')
     group by 2, btrim(x.value ->> 'name'), btrim(coalesce(x.value ->> 'description', ''))$new$
);

drop function pg_temp.d1c_patch_function(regprocedure, text, text);

-- ---------- v2.5 の版から下書きを作るのを止めていたトリガーを外す ----------
-- （v2.5 の版から作った見積の改訂の下書きも、直前の発行版から元の版を引き継ぐため、同じトリガーで止まっていた）

drop trigger quote_drafts_v25_standard_estimate_guard on public.quote_drafts;
drop function public.quote_drafts_v25_standard_estimate_guard();

-- ---------- 権限 ----------

alter function public.standard_estimate_v25_quote_draft_lines(uuid) owner to postgres;
revoke all on function public.standard_estimate_v25_quote_draft_lines(uuid) from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
begin
  if has_function_privilege('anon', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.standard_estimate_v25_quote_draft_lines(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: standard_estimate_v25_quote_draft_lines must not be executable by API roles';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.materialize_standard_quote_draft(uuid, uuid)'::regprocedure),
                       'standard_estimate_v25_quote_draft_lines(rev.id)') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.assert_quote_draft_lines_resolved(uuid)'::regprocedure),
                          'standard_estimate_v25_quote_draft_lines(v_standard)') = 0 then
    raise exception 'POSTCONDITION: the draft functions were not patched';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid = 'public.quote_drafts'::regclass and t.tgname = 'quote_drafts_v25_standard_estimate_guard') then
    raise exception 'POSTCONDITION: the v2.5 quote draft guard must be removed';
  end if;
  -- 既存の下書き・見積は変えていない（関数とトリガーだけ）
end;
$postconditions$;

commit;
