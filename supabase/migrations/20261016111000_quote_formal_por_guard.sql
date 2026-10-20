-- 正式見積の発行で、未解決の別途見積（POR）を残さない（D1 までの暫定。2026-10-19 の先方回答 ③）
--
-- 先方の方針
--   ・正式見積の発行には範囲と金額の確定が必要。未解決の POR が残る状態では正式見積を発行できない
--   ・Web での概算確認・見積依頼の受付・下書き保存は続けられる（この migration では変えない）
--
-- いまの作りでの POR の表し方（調べた結果）
--   ・Web の概算（create_quote_from_configuration）：POR の商品は 0 円で、説明「設置場所確認後に別途お見積り」。
--     標準見積から作る概算は、POR の明細を 0 円・備考「価格未確定（別途お見積り）」で写す。
--     お客様が選んだ POR の商品・選択肢は「選択商品の変更差額」に 0 円で含まれ、明細に出ないことがある
--   ・手入力の見積・改訂の画面：POR の商品は 0 円・備考「別途見積」で入る
--   ・標準見積から作る下書き：price_mode = 'por'（既存の確認で正式保存を止めている）
--
-- 足す止め（正式見積を作る 4 つの関数）
--   1. 発行する明細に「未解決の POR の行」が残っていれば発行しない。未解決の POR の行は、0 円で次のどれかに当たる行
--        ・備考が POR の目印（「別途見積」「価格未確定（別途お見積り）」「別途見積項目あり…」）
--        ・備考が空で、説明が「設置場所確認後に別途お見積り」か、商品台帳の POR の商品を指している
--      解消のしかた：売価を入れる／0 円のままにするなら備考に理由（ほかの明細に含む など）を書く／明細から外す
--   2. Web の案件では、お客様が選んだ POR の商品・選択肢（外壁の面を含む）について、発行する担当者が
--      「金額を明細に入れたか、お客様と合意のうえ対象外にした」ことを確認した記録がなければ発行しない。
--      明細に出ない POR があるため。確認の記録は見積の版ごと・担当者ごとに残し、変えられない
--
-- 対象の関数
--   ・finalize_quote_draft・finalize_quote_revision_draft（Web 以外の下書きの正式保存）
--   ・create_quote_revision（発行中の見積の改訂＝確定見積）
--   ・create_formal_quote_from_accepted_preliminary（承諾済みの概算からの確定見積。旧形式の互換）
-- 既存の関数は、適用済みの定義（pg_get_functiondef）の目印がちょうど 1 箇所あることを確かめてから足す。
-- 想定と違う定義なら何も変えずに止まる。owner・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを検算する。
-- 既存 migration は編集しない。発行済みの見積・明細のデータは変えない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.finalize_quote_draft(uuid, integer)') is null
     or to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)') is null
     or to_regprocedure('public.create_quote_revision(uuid, jsonb, text)') is null
     or to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)') is null then
    raise exception 'PRECONDITION: quote issuance functions are missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quote_draft_items' and column_name = 'price_mode'
  ) then
    raise exception 'PRECONDITION: quote standard estimate money (20261013180000) must be applied first';
  end if;
  if to_regclass('public.quote_por_confirmations') is not null
     or to_regprocedure('public.quote_line_is_unresolved_por(numeric, uuid, text, text)') is not null then
    raise exception 'PRECONDITION: quote formal POR guard already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 未解決の POR の行（SQL と lib/domain/quote-por.ts で同じ決まり） ----------

create function public.quote_line_is_unresolved_por(
  p_unit_price numeric,
  p_option_id uuid,
  p_description text,
  p_remark text
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(p_unit_price, 0) = 0
     and (
       btrim(coalesce(p_remark, '')) in ('別途見積', '価格未確定（別途お見積り）')
       or btrim(coalesce(p_remark, '')) like '別途見積項目あり%'
       or (
         btrim(coalesce(p_remark, '')) = ''
         and (
           btrim(coalesce(p_description, '')) = '設置場所確認後に別途お見積り'
           or exists (
             select 1
               from public.options o
              where o.id = p_option_id
                and o.price_on_request
           )
         )
       )
     );
$function$;

comment on function public.quote_line_is_unresolved_por(numeric, uuid, text, text) is
  '正式見積の明細で未解決の別途見積（POR）とみなす行か（D1 までの暫定）。0 円で、備考が POR の目印、または備考が空で説明が「設置場所確認後に別途お見積り」か POR の商品を指す行。';

-- ---------- お客様が選んだ POR の商品・選択肢（Web の案件） ----------

create function public.configuration_por_selections(p_configuration_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  with cfg as (
    select c.id,
           c.exterior_faces,
           coalesce(jsonb_typeof(c.exterior_faces) = 'array' and jsonb_array_length(c.exterior_faces) = 4, false) as has_faces
      from public.configurations c
     where c.id = p_configuration_id
  ),
  picked as (
    -- 外壁を面ごとに選んだ構成では、外壁の商品は面の選択として数える（見積の明細と同じ扱い）
    select ci.option_id, ci.variant_choice_ids, o.name, o.price_on_request,
           cat.sort_order as category_sort, o.sort_order as option_sort
      from cfg
      join public.configuration_items ci on ci.configuration_id = cfg.id
      join public.options o on o.id = ci.option_id
      join public.option_categories cat on cat.id = o.category_id
     where not (cfg.has_faces and cat.code = 'exterior-wall')
  ),
  faces as (
    select f.value ->> 'face_code' as face_code,
           (f.value ->> 'option_id')::uuid as option_id,
           coalesce(f.value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids,
           f.ordinality::integer as face_sort
      from cfg
      cross join lateral jsonb_array_elements(cfg.exterior_faces) with ordinality as f(value, ordinality)
     where cfg.has_faces
  ),
  por_rows as (
    select 'product:' || p.option_id::text as key, p.option_id, p.name, null::text as detail,
           0 as s0, p.category_sort as s1, p.option_sort as s2, 0 as s3
      from picked p
     where p.price_on_request
    union all
    select 'variant:' || p.option_id::text || ':' || vc.id::text, p.option_id, p.name, vg.name || '：' || vc.name,
           0, p.category_sort, p.option_sort, 1 + vg.sort_order * 10000 + vc.sort_order
      from picked p
      join public.option_variant_choices vc on vc.id = any(p.variant_choice_ids) and vc.price_on_request
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = p.option_id
    union all
    select 'face:' || fc.face_code || ':' || o.id::text, o.id, o.name,
           '外壁（' || case fc.face_code
                         when 'front' then '正面'
                         when 'right' then '右側面'
                         when 'back' then '背面'
                         when 'left' then '左側面'
                         else fc.face_code
                       end || '）' || coalesce('：' || por.labels, ''),
           1, 0, fc.face_sort, 0
      from faces fc
      join public.options o on o.id = fc.option_id
      left join lateral (
        select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as labels
          from jsonb_array_elements_text(fc.variant_choice_ids) as j(choice_id)
          join public.option_variant_choices vc on vc.id = j.choice_id::uuid and vc.price_on_request
          join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
      ) por on true
     where o.price_on_request or por.labels is not null
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('key', r.key, 'option_id', r.option_id, 'name', r.name, 'detail', r.detail)
             order by r.s0, r.s1, r.s2, r.s3, r.key
           ),
           '[]'::jsonb
         )
    from por_rows r;
$function$;

comment on function public.configuration_por_selections(uuid) is
  'Web の案件でお客様が選んだ別途見積（POR）の商品・選択肢・外壁の面の一覧（key・option_id・name・detail）。見積の明細に出ない POR を確認するために使う（D1 までの暫定）。';

-- ---------- 確認の記録 ----------

create table public.quote_por_confirmations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  selections jsonb not null
    constraint quote_por_confirmations_selections_check
    check (jsonb_typeof(selections) = 'array' and jsonb_array_length(selections) > 0),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now()
);

create index quote_por_confirmations_quote_idx
  on public.quote_por_confirmations (quote_id, confirmed_by);

comment on table public.quote_por_confirmations is
  'Web の案件で、発行する担当者が「お客様が選んだ別途見積の商品は、金額を明細に入れたか、お客様と合意のうえ対象外にした」と確認した記録（見積の版ごと）。変更・削除できない。D1 までの暫定。';
comment on column public.quote_por_confirmations.quote_id is '確認したときの見積（改訂・確定見積の元になる版）。';
comment on column public.quote_por_confirmations.selections is '確認したときの別途見積の商品・選択肢の一覧（configuration_por_selections の結果）。';
comment on column public.quote_por_confirmations.confirmed_by is '確認した利用者（auth.uid）。記録を変えないため外部キーにしない。';

create function public.quote_por_confirmations_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'IMMUTABLE: 別途見積の確認の記録は変更・削除できません' using errcode = 'P0001';
end;
$function$;

create trigger trg_quote_por_confirmations_immutable
before update or delete on public.quote_por_confirmations
for each row execute function public.quote_por_confirmations_immutable();

alter table public.quote_por_confirmations enable row level security;

revoke all privileges on table public.quote_por_confirmations from public, anon, authenticated;
grant all privileges on table public.quote_por_confirmations to service_role;

-- いまの一覧を、その担当者の確認の記録が覆っているか（一覧が空なら確認は要らない）
create function public.quote_por_selections_confirmed(p_quote_id uuid, p_user_id uuid, p_selections jsonb)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select jsonb_array_length(coalesce(p_selections, '[]'::jsonb)) = 0
      or exists (
        select 1
          from public.quote_por_confirmations c
         where c.quote_id = p_quote_id
           and c.confirmed_by = p_user_id
           and (select coalesce(array_agg(e ->> 'key'), '{}'::text[]) from jsonb_array_elements(p_selections) as e)
               <@ (select coalesce(array_agg(e ->> 'key'), '{}'::text[]) from jsonb_array_elements(c.selections) as e)
      );
$function$;

-- ---------- 画面から使う RPC ----------

-- 改訂・確定見積の画面用：お客様が選んだ別途見積の商品と、自分の確認が済んでいるか
create function public.get_quote_por_selections(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  q public.quotes;
  v_selections jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 見積を改訂・確定できる人（本部、または担当の代理店・総代理店）と同じ範囲
  if not (v_rank >= 3 or (v_rank >= 1 and coalesce(q.dealer_id = v_uid, false))) then
    raise exception 'FORBIDDEN: この案件の別途見積を確認できません' using errcode = '42501';
  end if;
  if q.configuration_id is not null then
    v_selections := public.configuration_por_selections(q.configuration_id);
  end if;
  return jsonb_build_object(
    'selections', v_selections,
    'confirmed', public.quote_por_selections_confirmed(q.id, v_uid, v_selections)
  );
end;
$function$;

-- 発行の前に、画面に出した一覧を確認したことを記録する（一覧が画面を開いた後に変わっていれば記録しない）
create function public.confirm_quote_por_selections(p_quote_id uuid, p_selection_keys text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  q public.quotes;
  v_current_quote_id uuid;
  v_selections jsonb;
  v_keys text[];
  v_given text[];
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 発行（create_quote_revision など）と同じく、見積の行を先に lock する
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_rank >= 3 or (v_rank >= 1 and coalesce(q.dealer_id = v_uid, false))) then
    raise exception 'FORBIDDEN: この案件の別途見積を確認できません' using errcode = '42501';
  end if;
  if q.configuration_id is null then
    raise exception 'VALIDATION: Web の見積依頼の案件ではないため、別途見積の商品の確認はありません' using errcode = 'P0001';
  end if;
  select r.quote_id into v_current_quote_id
    from public.quote_requests r
   where r.id = q.quote_request_id;
  if v_current_quote_id is distinct from q.id or q.status not in ('issued', 'accepted') then
    raise exception 'LOCKED: この見積は最新の版ではありません。画面を再読み込みしてください' using errcode = 'P0001';
  end if;

  v_selections := public.configuration_por_selections(q.configuration_id);
  if jsonb_array_length(v_selections) = 0 then
    raise exception 'VALIDATION: 確認が必要な別途見積の商品はありません' using errcode = 'P0001';
  end if;
  select array_agg(distinct (e ->> 'key') order by (e ->> 'key')) into v_keys
    from jsonb_array_elements(v_selections) as e;
  select array_agg(distinct u.k order by u.k) into v_given
    from unnest(coalesce(p_selection_keys, '{}'::text[])) as u(k);
  if v_keys is distinct from v_given then
    raise exception 'LOCKED: 別途見積の商品が、画面を開いた後に変わりました。画面を再読み込みして確認し直してください' using errcode = 'P0001';
  end if;

  -- 同じ担当者が同じ一覧をすでに確認していれば、その記録を返す（二重に残さない）
  select c.id into v_id
    from public.quote_por_confirmations c
   where c.quote_id = q.id
     and c.confirmed_by = v_uid
     and c.selections = v_selections
   order by c.confirmed_at
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.quote_por_confirmations (quote_id, selections, confirmed_by)
  values (q.id, v_selections, v_uid)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---------- 発行の関数の中から使う確認 ----------

-- 発行する版（quote_items）に、未解決の POR の行が残っていれば止める
create function public.assert_quote_lines_por_resolved(p_quote_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_count integer;
  v_names text;
begin
  select count(*), string_agg(i.name, '、' order by i.sort_order, i.id)
    into v_count, v_names
    from public.quote_items i
   where i.quote_id = p_quote_id
     and public.quote_line_is_unresolved_por(i.unit_price, i.option_id, i.description, i.remark);
  if v_count > 0 then
    raise exception 'VALIDATION: 別途見積（価格未確定）の明細が % 行残っています（%）。売価を入力するか、0 円のままにする場合は備考に理由（ほかの明細に含む など）を書くか、明細から外してから発行してください',
      v_count, left(v_names, 200)
      using errcode = 'P0001';
  end if;
end;
$function$;

-- 正式保存する下書き（quote_draft_items）に、未解決の POR の行が残っていれば止める
create function public.assert_quote_draft_lines_por_resolved(p_draft_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_count integer;
  v_names text;
begin
  select count(*), string_agg(i.name, '、' order by i.sort_order, i.id)
    into v_count, v_names
    from public.quote_draft_items i
   where i.draft_id = p_draft_id
     and public.quote_line_is_unresolved_por(i.unit_price, i.option_id, i.description, i.remark);
  if v_count > 0 then
    raise exception 'VALIDATION: 別途見積（価格未確定）の明細が % 行残っています（%）。売価を入力するか、0 円のままにする場合は備考に理由（ほかの明細に含む など）を書くか、明細から外してから正式保存してください',
      v_count, left(v_names, 200)
      using errcode = 'P0001';
  end if;
end;
$function$;

-- Web の案件で、発行する担当者がお客様の選んだ POR の商品を確認していなければ止める
create function public.assert_case_por_selections_confirmed(p_parent_quote_id uuid, p_user_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_configuration_id uuid;
  v_selections jsonb;
  v_names text;
begin
  select q.configuration_id into v_configuration_id
    from public.quotes q
   where q.id = p_parent_quote_id;
  if v_configuration_id is null then
    return;
  end if;
  v_selections := public.configuration_por_selections(v_configuration_id);
  if public.quote_por_selections_confirmed(p_parent_quote_id, p_user_id, v_selections) then
    return;
  end if;
  select string_agg((e.value ->> 'name') || coalesce('（' || (e.value ->> 'detail') || '）', ''), '、' order by e.ordinality)
    into v_names
    from jsonb_array_elements(v_selections) with ordinality as e(value, ordinality);
  raise exception 'VALIDATION: お客様が選んだ別途見積の商品（% 件：%）について、金額を明細に入れたか、お客様と合意のうえ対象外にしたことの確認が済んでいません。画面の「別途見積の確認」で確認してから発行してください',
    jsonb_array_length(v_selections), left(v_names, 200)
    using errcode = 'P0001';
end;
$function$;

-- ---------- 権限 ----------

alter function public.quote_line_is_unresolved_por(numeric, uuid, text, text) owner to postgres;
alter function public.configuration_por_selections(uuid) owner to postgres;
alter function public.quote_por_confirmations_immutable() owner to postgres;
alter function public.quote_por_selections_confirmed(uuid, uuid, jsonb) owner to postgres;
alter function public.get_quote_por_selections(uuid) owner to postgres;
alter function public.confirm_quote_por_selections(uuid, text[]) owner to postgres;
alter function public.assert_quote_lines_por_resolved(uuid) owner to postgres;
alter function public.assert_quote_draft_lines_por_resolved(uuid) owner to postgres;
alter function public.assert_case_por_selections_confirmed(uuid, uuid) owner to postgres;

-- 内部の部品は利用者から実行させない（発行の関数の中からだけ使う）
revoke execute on function public.quote_line_is_unresolved_por(numeric, uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.configuration_por_selections(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.quote_por_confirmations_immutable() from public, anon, authenticated, service_role;
revoke execute on function public.quote_por_selections_confirmed(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.assert_quote_lines_por_resolved(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.assert_quote_draft_lines_por_resolved(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.assert_case_por_selections_confirmed(uuid, uuid) from public, anon, authenticated, service_role;

revoke execute on function public.get_quote_por_selections(uuid) from public, anon, service_role;
revoke execute on function public.confirm_quote_por_selections(uuid, text[]) from public, anon, service_role;
grant execute on function public.get_quote_por_selections(uuid) to authenticated;
grant execute on function public.confirm_quote_por_selections(uuid, text[]) to authenticated;

comment on function public.get_quote_por_selections(uuid) is
  '改訂・確定見積の画面用。Web の案件でお客様が選んだ別途見積の商品・選択肢と、自分の確認が済んでいるか。本部と担当の代理店・総代理店だけ。';
comment on function public.confirm_quote_por_selections(uuid, text[]) is
  '発行の前に、画面に出した別途見積の商品の一覧を確認したことを記録する。一覧が画面を開いた後に変わっていれば LOCKED。';

-- ---------- 正式見積を作る 4 つの関数に止めを足す ----------

do $patch$
declare
  v_signatures constant text[] := array[
    'public.finalize_quote_draft(uuid, integer)',
    'public.finalize_quote_revision_draft(uuid, integer)',
    'public.create_quote_revision(uuid, jsonb, text)',
    'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'
  ];
  v_from text[];
  v_to text[];
  v_index integer;
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
begin
  v_from := array[
    -- finalize_quote_draft：既存の POR（price_mode）の確認の直後
    E'  if exists (\n'
    || E'    select 1 from public.quote_draft_items por\n'
    || E'     where por.draft_id = d.id\n'
    || E'       and (por.price_mode = ''por'' or por.unit_price is null or por.amount is null)\n'
    || E'  ) then\n'
    || E'    raise exception ''VALIDATION: 価格未確定（POR）の明細が残っています。自動計算か売価の入力で価格を確定してから正式保存してください'' using errcode = ''P0001'';\n'
    || E'  end if;\n',
    -- finalize_quote_revision_draft：既存の POR（price_mode）の確認の直後
    E'  if exists (\n'
    || E'    select 1 from public.quote_draft_items por\n'
    || E'     where por.draft_id = d.id\n'
    || E'       and (por.price_mode = ''por'' or por.unit_price is null or por.amount is null)\n'
    || E'  ) then\n'
    || E'    raise exception ''VALIDATION: 価格未確定（POR）の明細が残っています。自動計算か売価の入力で価格を確定してから正式保存してください''\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n',
    -- create_quote_revision：新しい版の明細を作り終え、元の版を置き換える直前
    E'  update public.quotes\n'
    || E'     set status = ''superseded''\n'
    || E'   where id = parent.id;\n',
    -- create_formal_quote_from_accepted_preliminary：明細を作り、案件の現在の見積を移した後、結果を返す直前（同じトランザクションの中なので、止めればすべて戻る）
    E'  return v_new;\n'
  ];
  v_to := array[
    v_from[1]
    || E'  /* 0 円のまま残った別途見積（POR）の行も、正式保存では残さない（D1 までの暫定）。 */\n'
    || E'  perform public.assert_quote_draft_lines_por_resolved(d.id);\n',
    v_from[2]
    || E'  /* 0 円のまま残った別途見積（POR）の行も、正式保存では残さない（D1 までの暫定）。 */\n'
    || E'  perform public.assert_quote_draft_lines_por_resolved(d.id);\n',
    E'  /* 確定見積として発行する前に、未解決の別途見積（POR）が残っていないか確かめる（D1 までの暫定）。 */\n'
    || E'  perform public.assert_quote_lines_por_resolved(v_new);\n'
    || E'  perform public.assert_case_por_selections_confirmed(parent.id, v_uid);\n'
    || E'\n'
    || v_from[3],
    E'  /* 確定見積として発行する前に、未解決の別途見積（POR）が残っていないか確かめる（D1 までの暫定）。 */\n'
    || E'  perform public.assert_quote_lines_por_resolved(v_new);\n'
    || E'  perform public.assert_case_por_selections_confirmed(parent.id, v_uid);\n'
    || E'\n'
    || v_from[4]
  ];

  for v_index in 1 .. array_length(v_signatures, 1) loop
    v_oid := to_regprocedure(v_signatures[v_index]);
    if v_oid is null then
      raise exception 'QUOTE_FORMAL_POR_GUARD: function % is missing', v_signatures[v_index] using errcode = 'P0001';
    end if;
    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    if strpos(v_definition, 'por_resolved(') > 0 or strpos(v_definition, 'por_selections_confirmed(') > 0 then
      raise exception 'QUOTE_FORMAL_POR_GUARD: % is already patched', v_signatures[v_index] using errcode = 'P0001';
    end if;
    if (length(v_definition) - length(replace(v_definition, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'QUOTE_FORMAL_POR_GUARD: % differs from the reviewed definition (anchor is not unique)', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_definition, v_from[v_index], v_to[v_index]);

    execute v_expected;

    select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after
      from pg_catalog.pg_proc p
     where p.oid = v_oid;
    if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
      raise exception 'QUOTE_FORMAL_POR_GUARD: % was not replaced as expected', v_signatures[v_index] using errcode = 'P0001';
    end if;
    if v_after.proowner is distinct from v_before.proowner
       or v_after.prosecdef is distinct from v_before.prosecdef
       or v_after.proconfig is distinct from v_before.proconfig
       or v_after.acl is distinct from v_before.acl then
      raise exception 'QUOTE_FORMAL_POR_GUARD: % owner / security definer / search_path / EXECUTE changed', v_signatures[v_index]
        using errcode = 'P0001';
    end if;
  end loop;
end;
$patch$;

commit;
