-- =============================================================
-- A-3：別途工事 9 品目を商品台帳から削除し、代理店の見積編集の初期明細（9 種類の工事）をマスターの表に持つ
-- =============================================================
-- 決まり（2026-11-04 の先方回答 A-3。10/21 の「9 商品を残したまま必須・初期選択だけ外す」を変更）
-- * 別途工事の 9 品目（sw-transport 〜 sw-site-expense）と、カテゴリー「別途工事（sitework）」を商品台帳から削除する
-- * 本体モデルのプランの標準構成（base_models.presets の option_codes）からも 9 品目を外す
-- * 9 品目を含む保存済みのプランと、つながる見積依頼・見積はテストデータとして削除する（本番は 18・10・10 件）。
--   見積依頼（見積・明細・PDF の記録が外部キーの決まりで一緒に消える）→ プラン（明細・写しが一緒に消える）の順に消す。
--   本番では、2026-11-04 の読み取りと同じ集合（件数と ID の並びの md5）のときだけ消す。違えば何も消さずに止める
-- * 契約・製造の指示・別途見積の確認・見積の下書き・変更の依頼・案件の記録が対象につながっていれば止める。
--   9 品目が対象の外（ほかの見積・下書き・標準見積・ログインなしの一時保存・原価の Version）から使われていても止める
-- * 消す行は、同じ DB の非公開のスキーマ（archive_a3_20261104。API のロールからは読めない）へ写してから消す。
--   先方の了承の後に、別の migration で写しを消す
-- * 見積書の「別途工事」の区分は残す。代理店の Excel 風の見積編集に最初から並べる 9 種類の工事は、
--   新しい表 quote_initial_lines（マスター）に持つ（9 品目の名前・並び順のまま。金額は持たない）
-- * 9 品目の無い DB（開発・検査用の空の DB）では、表と写しの場所を作り、初期明細を入れるだけで、何も消さない
-- * Web 以外の案件（構成の無い見積依頼）とその下書き、ほかの商品・カテゴリー・標準見積・本体マスター・通知の履歴は変えない
-- 既存 migration は編集しない。
-- =============================================================

begin;

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null
     or to_regprocedure('public.create_quote_revision_v25(uuid, jsonb, integer, text, text)') is null
     or to_regclass('public.standard_estimate_revision_slot_options') is null then
    raise exception 'PRECONDITION: v2.5 (20261016200000 〜 20261102140000) must be applied first';
  end if;
  if to_regprocedure('public.assert_option_unreferenced(uuid, text)') is null
     or to_regprocedure('public.enforce_configuration_item_draft_parent()') is null then
    raise exception 'PRECONDITION: product delete guard / configuration item guard are missing';
  end if;
  if to_regclass('public.quote_initial_lines') is not null
     or to_regnamespace('archive_a3_20261104') is not null
     or to_regprocedure('public.remove_sitework_catalog(jsonb)') is not null then
    raise exception 'PRECONDITION: A-3 objects already exist';
  end if;
end;
$preflight$;

-- ---------- 見積の初期明細（マスター） ----------

create table public.quote_initial_lines (
  id uuid primary key default gen_random_uuid(),
  section_code text not null check (section_code in ('sitework')),
  name text not null check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 120),
  unit text not null default '式' check (pg_catalog.char_length(unit) between 1 and 12),
  sort_order integer not null check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_initial_lines_section_name_key unique (section_code, name)
);

comment on table public.quote_initial_lines is
  '見積の編集で最初から並べる明細（いまは別途工事の 9 種類の工事）。代理店が現地確認のうえ、使う行に金額を入れ、要らない行は外す。金額は持たない（2026-11-04 の先方回答 A-3）';

alter table public.quote_initial_lines enable row level security;
revoke all on table public.quote_initial_lines from public, anon, authenticated, service_role;
grant select on table public.quote_initial_lines to authenticated, service_role;

-- 担当者（代理店・総代理店・本部）だけが読む。変えるのは migration（本部の管理画面は必要になったときに足す）
create policy quote_initial_lines_staff_read on public.quote_initial_lines
  for select to authenticated
  using (coalesce(public.current_role_rank(), 0) >= 1);

-- 9 種類の工事（削除する 9 品目の名前・並び順のまま。lib/seed/quote-initial-lines.ts と同じ）
insert into public.quote_initial_lines (section_code, name, unit, sort_order)
values ('sitework', '運送費', '式', 1),
       ('sitework', '設計監理及び確認申請費', '式', 2),
       ('sitework', '梱包養生', '式', 3),
       ('sitework', '現場設置工事', '式', 4),
       ('sitework', '電気設備工事', '式', 5),
       ('sitework', '給排水給湯設備工事', '式', 6),
       ('sitework', '基礎工事（設置後工事）', '式', 7),
       ('sitework', '廃材処分費', '式', 8),
       ('sitework', '別途現場諸費用', '式', 9);

-- ---------- 消す行の写し（非公開。API のロールからは読めない） ----------

create schema archive_a3_20261104;
revoke all on schema archive_a3_20261104 from public, anon, authenticated, service_role;
comment on schema archive_a3_20261104 is
  'A-3（2026-11-04 の先方回答）で削除した別途工事 9 品目・カテゴリー・テストデータの写し。元に戻すときだけ使う。先方の了承の後、別の migration で消す';

create table archive_a3_20261104.option_categories as select * from public.option_categories with no data;
create table archive_a3_20261104.options as select * from public.options with no data;
create table archive_a3_20261104.base_model_presets (base_model_id uuid primary key, presets jsonb not null);
create table archive_a3_20261104.configurations as select * from public.configurations with no data;
create table archive_a3_20261104.configuration_items as select * from public.configuration_items with no data;
create table archive_a3_20261104.configuration_snapshots as select * from public.configuration_snapshots with no data;
create table archive_a3_20261104.configuration_site_profiles as select * from public.configuration_site_profiles with no data;
create table archive_a3_20261104.quote_requests as select * from public.quote_requests with no data;
create table archive_a3_20261104.quote_request_preferences as select * from public.quote_request_preferences with no data;
create table archive_a3_20261104.quotes as select * from public.quotes with no data;
create table archive_a3_20261104.quote_items as select * from public.quote_items with no data;
create table archive_a3_20261104.quote_documents as select * from public.quote_documents with no data;

-- ---------- 削除の本体（内部。API のロールからは実行させない） ----------
-- p_expected：{ "configurations": { "count": n, "md5": "..." }, "quote_requests": {...}, "quotes": {...} }
--   md5 は ID の並び（昇順・カンマ区切り）の md5。対象が空なら、商品・カテゴリー・標準構成だけを消す
create function public.remove_sitework_catalog(p_expected jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $remove$
declare
  v_codes constant text[] := array['sw-transport', 'sw-design-permit', 'sw-packing', 'sw-site-install', 'sw-electric',
                                    'sw-plumbing', 'sw-foundation', 'sw-disposal', 'sw-site-expense'];
  v_cat uuid;
  v_products uuid[];
  v_cfg uuid[];
  v_req uuid[];
  v_quote uuid[];
  v_actual jsonb;
  v_keep_requests integer;
  v_keep_drafts integer;
begin
  select c.id into v_cat from public.option_categories c where c.code = 'sitework';
  if v_cat is null then
    return pg_catalog.jsonb_build_object('skipped', true);
  end if;

  -- カテゴリーの商品は 9 品目だけ（ほかの商品があれば止める。商品台帳のほかの整理は別工程）
  if exists (select 1 from public.options o where o.category_id = v_cat and not (o.code = any(v_codes)))
     or exists (select 1 from public.options o where o.code = any(v_codes) and o.category_id is distinct from v_cat) then
    raise exception 'A3_STOP: 別途工事のカテゴリーに 9 品目以外の商品がある（または 9 品目が別のカテゴリーにある）ため止めました' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(o.id order by o.id), '{}'::uuid[]) into v_products from public.options o where o.category_id = v_cat;

  -- 対象の集合：9 品目を含むプラン → その見積依頼 → その見積
  select coalesce(array_agg(distinct ci.configuration_id order by ci.configuration_id), '{}'::uuid[]) into v_cfg
    from public.configuration_items ci
   where ci.option_id = any(v_products);
  select coalesce(array_agg(r.id order by r.id), '{}'::uuid[]) into v_req
    from public.quote_requests r where r.configuration_id = any(v_cfg);
  select coalesce(array_agg(q.id order by q.id), '{}'::uuid[]) into v_quote
    from public.quotes q where q.quote_request_id = any(v_req) or q.configuration_id = any(v_cfg);

  v_actual := pg_catalog.jsonb_build_object(
    'configurations', pg_catalog.jsonb_build_object('count', pg_catalog.cardinality(v_cfg), 'md5', pg_catalog.md5(pg_catalog.array_to_string(v_cfg, ','))),
    'quote_requests', pg_catalog.jsonb_build_object('count', pg_catalog.cardinality(v_req), 'md5', pg_catalog.md5(pg_catalog.array_to_string(v_req, ','))),
    'quotes', pg_catalog.jsonb_build_object('count', pg_catalog.cardinality(v_quote), 'md5', pg_catalog.md5(pg_catalog.array_to_string(v_quote, ','))));
  if pg_catalog.cardinality(v_cfg) + pg_catalog.cardinality(v_req) + pg_catalog.cardinality(v_quote) > 0
     and v_actual is distinct from p_expected then
    raise exception 'A3_STOP: 削除の対象（プラン・見積依頼・見積）が確認のときと違うため止めました（実際：%）', v_actual::text using errcode = 'P0001';
  end if;

  -- 対象につながる記録（どれかあれば止める）
  if exists (select 1 from public.contracts x where x.quote_id = any(v_quote) or x.quote_request_id = any(v_req))
     or exists (select 1 from public.manufacturing_orders x where x.quote_id = any(v_quote) or x.quote_request_id = any(v_req))
     or exists (select 1 from public.quote_por_confirmations x where x.quote_id = any(v_quote))
     or exists (select 1 from public.quote_drafts x where x.parent_quote_id = any(v_quote) or x.quote_request_id = any(v_req))
     or exists (select 1 from public.quote_change_requests x where x.quote_id = any(v_quote) or x.quote_request_id = any(v_req))
     or exists (select 1 from public.quote_internal_snapshots x where x.quote_id = any(v_quote))
     or exists (select 1 from public.quote_item_cost_pins x where x.quote_id = any(v_quote))
     or exists (select 1 from public.case_workflows x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_notes x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_files x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_appointments x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_schedule_items x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_progress_reports x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_handovers x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.case_punch_items x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.site_surveys x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.disaster_consents x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.after_service_requests x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.manufacturing_units x where x.quote_request_id = any(v_req))
     or exists (select 1 from public.stock_ledger_entries x where x.quote_request_id = any(v_req)) then
    raise exception 'A3_STOP: 削除の対象に、契約・製造・別途見積の確認・下書き・変更の依頼・案件の記録がつながっているため止めました' using errcode = 'P0001';
  end if;
  -- 9 品目が対象の外から使われていれば止める（ほかの見積・下書き・標準見積・ログインなしの一時保存・原価の Version）
  if exists (select 1 from public.quote_items qi where qi.option_id = any(v_products) and not (qi.quote_id = any(v_quote)))
     or exists (select 1 from public.quote_draft_items di where di.option_id = any(v_products))
     or exists (select 1 from public.standard_estimate_revision_baseline_items bi
                 where bi.option_category_id = v_cat or bi.option_id = any(v_products))
     or exists (select 1 from public.standard_estimate_revision_slot_options so where so.option_id = any(v_products))
     or exists (select 1 from public.option_standard_cost_versions cv where cv.option_id = any(v_products))
     or exists (select 1 from public.option_hq_standard_costs hc where hc.option_id = any(v_products))
     or exists (select 1 from public.guest_plans g
                 where exists (select 1 from unnest(v_products) p(id) where pg_catalog.strpos(g.plan::text, p.id::text) > 0)) then
    raise exception 'A3_STOP: 9 品目が、削除の対象の外（見積・下書き・標準見積・一時保存・原価）から使われているため止めました' using errcode = 'P0001';
  end if;

  -- 残すデータ（Web 以外の案件とその下書きなど）の件数を控える
  select count(*) into v_keep_requests from public.quote_requests r where not (r.id = any(v_req));
  select count(*) into v_keep_drafts from public.quote_drafts d;

  -- 写す（消す前に）
  insert into archive_a3_20261104.option_categories select * from public.option_categories c where c.id = v_cat;
  insert into archive_a3_20261104.options select * from public.options o where o.id = any(v_products);
  insert into archive_a3_20261104.base_model_presets (base_model_id, presets)
    select bm.id, bm.presets from public.base_models bm
     where exists (
       select 1
         from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
         cross join lateral pg_catalog.jsonb_array_elements_text(
           case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
        where oc.code = any(v_codes));
  insert into archive_a3_20261104.configurations select * from public.configurations x where x.id = any(v_cfg);
  insert into archive_a3_20261104.configuration_items select * from public.configuration_items x where x.configuration_id = any(v_cfg);
  insert into archive_a3_20261104.configuration_snapshots select * from public.configuration_snapshots x where x.configuration_id = any(v_cfg);
  insert into archive_a3_20261104.configuration_site_profiles select * from public.configuration_site_profiles x where x.configuration_id = any(v_cfg);
  insert into archive_a3_20261104.quote_requests select * from public.quote_requests x where x.id = any(v_req);
  insert into archive_a3_20261104.quote_request_preferences select * from public.quote_request_preferences x where x.quote_request_id = any(v_req);
  insert into archive_a3_20261104.quotes select * from public.quotes x where x.id = any(v_quote);
  insert into archive_a3_20261104.quote_items select * from public.quote_items x where x.quote_id = any(v_quote);
  insert into archive_a3_20261104.quote_documents select * from public.quote_documents x where x.quote_id = any(v_quote);

  -- 消す：見積依頼（見積・明細・PDF の記録が外部キーで一緒に消える）→ 見積依頼の無い見積（あれば）→ プラン（明細・写しが一緒に消える）
  -- → 標準構成から外す → 9 品目 → カテゴリー。見積はプランも参照する（quotes.configuration_id は削除時に確かめるだけ）ので、
  -- プランより先に見積を消す。見積依頼から消すと、見積依頼の「今の見積」を書き換えずに済む
  delete from public.quote_requests x where x.id = any(v_req);
  delete from public.quotes x where x.id = any(v_quote);
  delete from public.configurations x where x.id = any(v_cfg);
  update public.base_models bm
     set presets = (
       select coalesce(pg_catalog.jsonb_agg(
                case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array'
                     then pg_catalog.jsonb_set(p.value, '{option_codes}', coalesce((
                            select pg_catalog.jsonb_agg(oc.value order by oc.ord)
                              from pg_catalog.jsonb_array_elements(p.value -> 'option_codes') with ordinality oc(value, ord)
                             where not ((oc.value #>> '{}') = any(v_codes))), '[]'::jsonb))
                     else p.value end
                order by p.ord), '[]'::jsonb)
         from pg_catalog.jsonb_array_elements(bm.presets) with ordinality p(value, ord))
   where bm.id in (select a.base_model_id from archive_a3_20261104.base_model_presets a);
  delete from public.options o where o.id = any(v_products);
  delete from public.option_categories c where c.id = v_cat;

  -- 確かめる（対象が消え、残すデータの件数が変わっていない）
  if exists (select 1 from public.quote_requests r where r.id = any(v_req))
     or exists (select 1 from public.quotes q where q.id = any(v_quote))
     or exists (select 1 from public.configurations c where c.id = any(v_cfg))
     or (select count(*) from public.quote_requests r) <> v_keep_requests
     or (select count(*) from public.quote_drafts d) <> v_keep_drafts then
    raise exception 'A3_STOP: 削除の後の件数が想定と違うため止めました' using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'removed', v_actual,
    'products', pg_catalog.cardinality(v_products),
    'presets_updated', (select count(*) from archive_a3_20261104.base_model_presets),
    'kept_quote_requests', v_keep_requests,
    'kept_quote_drafts', v_keep_drafts);
end;
$remove$;

alter function public.remove_sitework_catalog(jsonb) owner to postgres;
revoke all on function public.remove_sitework_catalog(jsonb) from public, anon, authenticated, service_role;

comment on function public.remove_sitework_catalog(jsonb) is
  'A-3：別途工事 9 品目・カテゴリー・標準構成の 9 品目と、9 品目を含むテストデータ（プラン・見積依頼・見積）を、写しを取ってから削除する。対象が p_expected と違えば止める。9 品目が無ければ何もしない。内部用（API からは実行させない）';

-- ---------- 本番の削除（2026-11-04 14:34 の読み取りの集合） ----------

select public.remove_sitework_catalog(pg_catalog.jsonb_build_object(
  'configurations', pg_catalog.jsonb_build_object('count', 18, 'md5', '052ab4ee62f1a393d616a2e759c200c5'),
  'quote_requests', pg_catalog.jsonb_build_object('count', 10, 'md5', 'c26addc61c32672f79dc7ddf8089aa56'),
  'quotes', pg_catalog.jsonb_build_object('count', 10, 'md5', '7640ea6300fe17b4b8b996e8c8c52284')));

-- ---------- postconditions ----------

do $postconditions$
begin
  if exists (select 1 from public.option_categories where code = 'sitework')
     or exists (select 1 from public.options where code in ('sw-transport', 'sw-design-permit', 'sw-packing', 'sw-site-install', 'sw-electric',
                                                             'sw-plumbing', 'sw-foundation', 'sw-disposal', 'sw-site-expense')) then
    raise exception 'POSTCONDITION: sitework catalog must be removed';
  end if;
  if (select count(*) from public.quote_initial_lines where section_code = 'sitework' and is_active) <> 9 then
    raise exception 'POSTCONDITION: the 9 initial sitework lines must exist';
  end if;
  if has_function_privilege('authenticated', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE') then
    raise exception 'POSTCONDITION: remove_sitework_catalog must not be executable by API roles';
  end if;
  if has_schema_privilege('authenticated', 'archive_a3_20261104', 'USAGE')
     or has_schema_privilege('anon', 'archive_a3_20261104', 'USAGE')
     or has_schema_privilege('service_role', 'archive_a3_20261104', 'USAGE') then
    raise exception 'POSTCONDITION: the archive schema must not be readable by API roles';
  end if;
  if has_table_privilege('anon', 'public.quote_initial_lines', 'SELECT')
     or has_table_privilege('authenticated', 'public.quote_initial_lines', 'INSERT')
     or has_table_privilege('authenticated', 'public.quote_initial_lines', 'UPDATE')
     or has_table_privilege('authenticated', 'public.quote_initial_lines', 'DELETE') then
    raise exception 'POSTCONDITION: quote_initial_lines privileges are not as expected';
  end if;
end;
$postconditions$;

commit;
