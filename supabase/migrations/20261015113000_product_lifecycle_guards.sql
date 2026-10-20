-- 商品の取扱終了・シミュレーター表示の保存境界（PR #500 の追加。2026-10-15 先方の最終指示書 v2）。
--
-- 20261015110000 で options に simulator_visible / archived_at を足した。ここでは、到達できるすべての保存・提出・発行の経路で、
-- 商品の状態の確認と書き込みを同じトランザクションの中で保証する（画面・Server Action の事前確認だけに頼らない）。
--
-- 業務の決まり：
-- * 取扱終了（status='published' かつ archived_at あり）は、新しい見積・シミュレーターで選べない。過去の履歴はそのまま残す
-- * simulator_visible=false はシミュレーターの新しい選択肢から外すだけ。見積・標準見積では選べる（見積不可ではない）
-- * 既存の Draft は、DB に保存済みだった明細（保存前の状態）だけを、表示・同じ明細のまま保持・削除・数量を減らす範囲で残せる。
--   数量を増やす・別明細として足す・一度消した後に足し直す・別商品から置き換える・選択肢を変える・別の面へ足すは新規選択として拒否する
-- * 取扱終了の商品が残っている状態では、見積依頼・見積の発行・標準見積の公開をしない（simulator_visible=false だけでは止めない）
-- * 商品 ID を持たない明細（標準見積・本体 Revision から写した行、自由入力の行）は判定しない（品名などから推測しない）
--
-- 作り：
-- * 状態の変更（取扱終了・再開・シミュレーター表示）は options のトリガーで検査する。公開中の標準見積・Excel 標準の基準商品・
--   必須・初期選択・前提商品・本体の仕様（プリセット）で使われている商品は取扱終了にしない（fail closed）
-- * 明細の表（configuration_items・quote_draft_items・standard_estimate_revision_baseline_items と選択肢）は行のトリガーで検査する。
--   「全部消して入れ直す」保存のため、消した行は同じトランザクションの中だけの一時領域（GUC）に覚え、入れ直す行と照合する
-- * 外壁 4 面（configurations.exterior_faces）は保存前の値と面ごとに照合する
-- * 見積依頼（quote_requests の追加）・見積の発行（quote_items の追加）・標準見積の公開は、取扱終了が残っていれば拒否する
-- * 商品の行には共有ロック（FOR SHARE）を取ってから判定する。取扱終了の更新（行ロック）と同時に来たときは、どちらかが待ち、
--   後から進んだ方が確定した状態で判定する（取扱終了が先なら新規選択を拒否、保存が先なら保存済みの明細として残る）
-- * シミュレーター非表示の商品でも、構成のモデル・仕様の標準構成（Excel 標準・公開中の標準見積・本体の仕様）に入っていれば、
--   構成に入れてよい（標準の価格を変えないため。お客様が新しく選ぶのではない）

begin;

-- トリガーを付ける表の lock を長く待たない（待っている間、後から来た通常の保存まで止めないため）。
-- 取れなければこの migration ごと失敗し、何も変わらない（画面の機能も有効にならない）
set local lock_timeout = '5s';

do $preflight$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'options' and column_name = 'archived_at'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'options' and column_name = 'simulator_visible'
  ) then
    raise exception 'PRECONDITION: product lifecycle columns (20261015110000) must be applied first';
  end if;
end;
$preflight$;

-- ---------- 判定の部品 ----------

-- 商品の状態（下書き・登録済み・取扱終了）。画面の productLedgerState と同じ
create function public.product_lifecycle_state(p_status text, p_archived_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_status is distinct from 'published' then 'draft'
           when p_archived_at is not null then 'retired'
           else 'registered'
         end;
$$;

-- 選択肢の ID を並べ替えて重複を除く（明細の同一性の比較に使う）
create function public.product_lifecycle_sorted_ids(p_ids uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) as x order by x), '{}'::uuid[]);
$$;

-- 消した明細を、同じトランザクションの中だけ覚える（GUC。トランザクションが終われば消える）
create function public.product_lifecycle_stash_add(p_key text, p_entry jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_all jsonb := coalesce(nullif(current_setting('wing.product_lifecycle_stash', true), '')::jsonb, '{}'::jsonb);
begin
  v_all := jsonb_set(v_all, array[p_key], coalesce(v_all -> p_key, '[]'::jsonb) || jsonb_build_array(p_entry), true);
  perform set_config('wing.product_lifecycle_stash', v_all::text, true);
end;
$$;

-- 覚えた明細のうち、同じ商品・同じ同一性・数量が以上のものを 1 件取り出す（取り出したものは二度使えない）
create function public.product_lifecycle_stash_take(p_key text, p_option_id uuid, p_identity text, p_quantity numeric)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_all jsonb := coalesce(nullif(current_setting('wing.product_lifecycle_stash', true), '')::jsonb, '{}'::jsonb);
  v_list jsonb;
  v_index integer;
  v_entry jsonb;
begin
  v_list := coalesce(v_all -> p_key, '[]'::jsonb);
  select (e.ordinality - 1)::integer, e.value
    into v_index, v_entry
    from jsonb_array_elements(v_list) with ordinality as e(value, ordinality)
   where e.value ->> 'option_id' = p_option_id::text
     and coalesce(e.value ->> 'identity', '') = coalesce(p_identity, '')
     and (e.value ->> 'quantity')::numeric >= p_quantity
   order by e.ordinality
   limit 1;
  if v_index is null then
    return null;
  end if;
  v_all := jsonb_set(v_all, array[p_key], v_list - v_index, true);
  perform set_config('wing.product_lifecycle_stash', v_all::text, true);
  return v_entry;
end;
$$;

-- 構成のモデル・仕様の標準構成に入っている商品（Excel 標準・公開中の標準見積・本体の仕様のプリセット）
create function public.product_lifecycle_baseline_option_ids(p_model_id uuid, p_spec_code text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.option_id), '{}'::uuid[])
    from (
      select unnest(t.baseline_option_ids) as option_id
        from public.estimate_templates t
       where t.base_model_id = p_model_id
         and t.spec_code = coalesce(p_spec_code, '')
      union
      select b.option_id
        from public.standard_estimate_masters m
        join public.standard_estimate_revision_baseline_items b on b.revision_id = m.current_published_revision_id
       where m.base_model_id = p_model_id
         and m.spec_code = p_spec_code
      union
      select o.id
        from public.base_models bm
        cross join lateral jsonb_array_elements(coalesce(bm.presets, '[]'::jsonb)) as preset(value)
        cross join lateral jsonb_array_elements_text(coalesce(preset.value -> 'option_codes', '[]'::jsonb)) as code(value)
        join public.options o on o.code = code.value and (o.base_model_id is null or o.base_model_id = bm.id)
       where bm.id = p_model_id
         and preset.value ->> 'code' = p_spec_code
    ) s
   where s.option_id is not null;
$$;

-- ---------- 商品の状態の変更（取扱終了・再開・シミュレーター表示） ----------

create function public.options_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.archived_at is distinct from old.archived_at then
    if old.archived_at is null and new.archived_at is not null then
      -- 取扱終了：登録済みの商品だけ。公開中の標準見積・価格の基準・必須関係・依存を壊す参照があれば止める
      if new.status is distinct from 'published' or old.status is distinct from 'published' then
        raise exception using errcode = 'P0001',
          message = 'VALIDATION: 取扱終了にできるのは登録済みの商品だけです。下書きは不要なら削除してください';
      end if;
      if exists (
        select 1
          from public.standard_estimate_masters m
          join public.standard_estimate_revision_baseline_items b on b.revision_id = m.current_published_revision_id
         where b.option_id = new.id
      ) then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: 公開中の標準見積の標準状態で使われているため、取扱終了にできません。先に標準見積の新しい Revision からこの商品を外して公開してください';
      end if;
      if exists (select 1 from public.estimate_templates t where new.id = any(t.baseline_option_ids)) then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: Excel 標準見積の基準商品として使われているため、取扱終了にできません。先に基準商品から外してください';
      end if;
      if new.is_required or new.is_default then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: 必須・初期選択の商品は取扱終了にできません。先に必須・初期選択の設定を外してください';
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
          message = format('LOCKED: 「%s」の前提商品として使われているため、取扱終了にできません。先に前提の設定を見直してください', v_name);
      end if;
      if exists (
        select 1
          from public.base_models bm
          cross join lateral jsonb_array_elements(coalesce(bm.presets, '[]'::jsonb)) as preset(value)
          cross join lateral jsonb_array_elements_text(coalesce(preset.value -> 'option_codes', '[]'::jsonb)) as code(value)
         where code.value = new.code
           and (new.base_model_id is null or new.base_model_id = bm.id)
      ) then
        raise exception using errcode = 'P0001',
          message = 'LOCKED: 本体の仕様（標準の商品構成）で使われているため、取扱終了にできません。先に仕様の商品構成から外してください';
      end if;
    elsif old.archived_at is not null and new.archived_at is null then
      -- 取扱再開：シミュレーター表示は以前の値のまま
      null;
    else
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: 取扱終了の日時は変更できません。取扱を再開してから、改めて終了してください';
    end if;
  end if;
  if new.simulator_visible is distinct from old.simulator_visible then
    if new.status is distinct from 'published' or new.archived_at is not null or old.archived_at is not null then
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: シミュレーター表示は、取扱中の登録済み商品だけで設定できます';
    end if;
  end if;
  return new;
end;
$$;

create trigger options_lifecycle_guard
before update of archived_at, simulator_visible on public.options
for each row execute function public.options_lifecycle_guard();

-- ---------- 構成（シミュレーター）の明細 ----------

-- 消す明細を覚える（保存は「全部消して入れ直す」ため、入れ直す行を保存前の状態と照合する）
create function public.configuration_items_lifecycle_stash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.product_lifecycle_stash_add(
    'configuration:' || old.configuration_id::text,
    jsonb_build_object(
      'option_id', old.option_id,
      'identity', public.product_lifecycle_sorted_ids(old.variant_choice_ids)::text,
      'quantity', old.quantity
    )
  );
  return old;
end;
$$;

create function public.configuration_items_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_state text;
  v_model uuid;
  v_spec text;
begin
  select x.id, x.name, x.status, x.archived_at, x.simulator_visible
    into o
    from public.options x
   where x.id = new.option_id
   for share;
  if not found then
    return new; -- 参照先が無い行は外部キーで止まる
  end if;
  v_state := public.product_lifecycle_state(o.status, o.archived_at);
  if v_state = 'draft' then
    raise exception using errcode = 'P0001',
      message = format('VALIDATION: 「%s」は下書きの商品のため選べません', o.name);
  end if;
  if v_state = 'registered' and o.simulator_visible then
    return new;
  end if;

  -- 保存済みの同じ明細（同じ商品・同じ選択肢）を、数量を増やさずに残すのは保持として許可する
  if tg_op = 'UPDATE'
     and old.option_id = new.option_id
     and public.product_lifecycle_sorted_ids(old.variant_choice_ids) = public.product_lifecycle_sorted_ids(new.variant_choice_ids)
     and new.quantity <= old.quantity then
    return new;
  end if;
  if tg_op = 'INSERT' and public.product_lifecycle_stash_take(
       'configuration:' || new.configuration_id::text,
       new.option_id,
       public.product_lifecycle_sorted_ids(new.variant_choice_ids)::text,
       new.quantity
     ) is not null then
    return new;
  end if;

  -- シミュレーター非表示でも、構成のモデル・仕様の標準構成に入っている商品は入れてよい
  if v_state = 'registered' then
    select cfg.base_model_id, cfg.spec_code into v_model, v_spec
      from public.configurations cfg
     where cfg.id = new.configuration_id;
    if new.option_id = any(public.product_lifecycle_baseline_option_ids(v_model, v_spec)) then
      return new;
    end if;
    raise exception using errcode = 'P0001',
      message = format('VALIDATION: 「%s」はシミュレーターでは新しく選べない商品です', o.name);
  end if;
  raise exception using errcode = 'P0001',
    message = format('RETIRED: 「%s」は取扱終了のため新しく選べません。取扱の再開を待つか、別の商品へ変更してください', o.name);
end;
$$;

create trigger configuration_items_lifecycle_stash
before delete on public.configuration_items
for each row execute function public.configuration_items_lifecycle_stash();

create trigger configuration_items_lifecycle_guard
before insert or update of option_id, quantity, variant_choice_ids on public.configuration_items
for each row execute function public.configuration_items_lifecycle_guard();

-- 外壁 4 面：面ごとに保存前の値と照合する（同じ面・同じ商品・同じ選択肢のままなら保持）
create function public.configurations_exterior_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_face jsonb;
  v_option uuid;
  o record;
  v_state text;
  v_baseline uuid[];
begin
  if new.exterior_faces is null or jsonb_typeof(new.exterior_faces) <> 'array' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.exterior_faces is not distinct from old.exterior_faces then
    return new;
  end if;
  for v_face in select value from jsonb_array_elements(new.exterior_faces)
  loop
    begin
      v_option := (v_face ->> 'option_id')::uuid;
    exception when others then
      continue; -- 形式の検査は validate_configuration_exterior_faces が行う
    end;
    if v_option is null then
      continue;
    end if;
    select x.id, x.name, x.status, x.archived_at, x.simulator_visible
      into o
      from public.options x
     where x.id = v_option
     for share;
    if not found then
      continue;
    end if;
    v_state := public.product_lifecycle_state(o.status, o.archived_at);
    if v_state = 'registered' and o.simulator_visible then
      continue;
    end if;
    if v_state = 'draft' then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 外壁「%s」は下書きの商品のため選べません', o.name);
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1
        from jsonb_array_elements(coalesce(old.exterior_faces, '[]'::jsonb)) as prev(value)
       where prev.value ->> 'face_code' = v_face ->> 'face_code'
         and prev.value ->> 'option_id' = v_option::text
         and public.product_lifecycle_sorted_ids(array(
               select c.value::uuid from jsonb_array_elements_text(coalesce(prev.value -> 'variant_choice_ids', '[]'::jsonb)) as c(value)
             ))
           = public.product_lifecycle_sorted_ids(array(
               select c.value::uuid from jsonb_array_elements_text(coalesce(v_face -> 'variant_choice_ids', '[]'::jsonb)) as c(value)
             ))
    ) then
      continue;
    end if;
    if v_state = 'registered' then
      if v_baseline is null then
        v_baseline := public.product_lifecycle_baseline_option_ids(new.base_model_id, new.spec_code);
      end if;
      if v_option = any(v_baseline) then
        continue;
      end if;
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 外壁「%s」はシミュレーターでは新しく選べない商品です', o.name);
    end if;
    raise exception using errcode = 'P0001',
      message = format('RETIRED: 外壁「%s」は取扱終了のため新しく選べません。取扱の再開を待つか、別の商品へ変更してください', o.name);
  end loop;
  return new;
end;
$$;

create trigger configurations_exterior_lifecycle_guard
before insert or update of exterior_faces on public.configurations
for each row execute function public.configurations_exterior_lifecycle_guard();

-- 必須カテゴリーの判定は、シミュレーターで新しく選べる商品だけで数える（取扱終了・非表示だけのカテゴリーで誰も満たせなくならないように）。
-- 必須カテゴリーの存在の判定に archived_at is null と simulator_visible を足した以外は、直前の定義と同じ
create or replace function public.validate_configuration_items(p_model_id uuid, p_option_ids uuid[], p_finish_level text default 'full'::text)
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
                  and o.archived_at is null and o.simulator_visible
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

-- ---------- 見積依頼（構成からの提出） ----------

create function public.quote_requests_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_names text;
begin
  if new.configuration_id is null then
    return new;
  end if;
  select coalesce(array_agg(distinct x.option_id), '{}'::uuid[])
    into v_ids
    from (
      select ci.option_id from public.configuration_items ci where ci.configuration_id = new.configuration_id
      union
      select (face.value ->> 'option_id')::uuid
        from public.configurations cfg
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(cfg.exterior_faces) = 'array' then cfg.exterior_faces else '[]'::jsonb end
        ) as face(value)
       where cfg.id = new.configuration_id
         and (face.value ->> 'option_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) x;
  perform 1 from public.options o where o.id = any(v_ids) order by o.id for share;
  select string_agg('「' || o.name || '」', '・' order by o.sort_order, o.id)
    into v_names
    from public.options o
   where o.id = any(v_ids)
     and public.product_lifecycle_state(o.status, o.archived_at) = 'retired';
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: %s は取扱終了のため、この内容では見積を依頼できません。取扱の再開を待つか、別の商品へ変更してください', v_names);
  end if;
  return new;
end;
$$;

create trigger quote_requests_lifecycle_guard
before insert on public.quote_requests
for each row execute function public.quote_requests_lifecycle_guard();

-- ---------- 見積の発行（明細の追加は発行のときだけ） ----------

create function public.quote_items_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
begin
  if new.option_id is null then
    return new; -- 商品 ID を持たない明細は判定しない
  end if;
  select x.name, x.status, x.archived_at into o from public.options x where x.id = new.option_id for share;
  if found and public.product_lifecycle_state(o.status, o.archived_at) = 'retired' then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: 「%s」は取扱終了のため、この内容では見積を発行できません。取扱を再開するか、別の商品へ変更してください', o.name);
  end if;
  return new;
end;
$$;

create trigger quote_items_lifecycle_guard
before insert on public.quote_items
for each row execute function public.quote_items_lifecycle_guard();

-- ---------- 見積の Draft（初回・改訂）の明細 ----------

create function public.quote_draft_items_lifecycle_stash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.option_id is not null then
    perform public.product_lifecycle_stash_add(
      'quote_draft:' || old.draft_id::text,
      jsonb_build_object('option_id', old.option_id, 'identity', old.line_key::text, 'quantity', old.quantity)
    );
  end if;
  return old;
end;
$$;

create function public.quote_draft_items_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  d record;
begin
  if new.option_id is null then
    return new;
  end if;
  select x.name, x.status, x.archived_at into o from public.options x where x.id = new.option_id for share;
  if not found or public.product_lifecycle_state(o.status, o.archived_at) <> 'retired' then
    return new; -- 見積ではシミュレーター非表示も選べる。下書き商品の扱いは各 RPC の従来の判定のまま
  end if;

  if tg_op = 'UPDATE' then
    if old.option_id = new.option_id and old.line_key = new.line_key and new.quantity <= old.quantity then
      return new;
    end if;
  else
    -- 保存済みの同じ明細（同じ line_key・同じ商品）を数量を増やさずに保存し直すのは保持（ON CONFLICT で更新になる行）
    if exists (
      select 1 from public.quote_draft_items i
       where i.draft_id = new.draft_id
         and i.line_key = new.line_key
         and i.option_id = new.option_id
         and i.quantity >= new.quantity
    ) then
      return new;
    end if;
    -- 「全部消して入れ直す」保存で、保存前にあった同じ明細
    if public.product_lifecycle_stash_take('quote_draft:' || new.draft_id::text, new.option_id, new.line_key::text, new.quantity) is not null then
      return new;
    end if;
    -- 発行済みの版から改訂 Draft を作るときの引き継ぎ（この Draft を作ったトランザクションの中で、親の版にある同じ明細だけ）
    select q.parent_quote_id, q.created_at into d from public.quote_drafts q where q.id = new.draft_id;
    if found and d.parent_quote_id is not null and d.created_at = now() and exists (
      select 1 from public.quote_items qi
       where qi.quote_id = d.parent_quote_id
         and qi.line_key = new.line_key
         and qi.option_id = new.option_id
         and qi.quantity >= new.quantity
    ) then
      return new;
    end if;
  end if;
  raise exception using errcode = 'P0001',
    message = format('RETIRED: 「%s」は取扱終了のため新しく選べません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）', o.name);
end;
$$;

create trigger quote_draft_items_lifecycle_stash
before delete on public.quote_draft_items
for each row execute function public.quote_draft_items_lifecycle_stash();

create trigger quote_draft_items_lifecycle_guard
before insert or update of option_id, quantity, line_key on public.quote_draft_items
for each row execute function public.quote_draft_items_lifecycle_guard();

-- ---------- 標準見積（Revision の標準状態） ----------

create function public.standard_estimate_baseline_lifecycle_stash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.product_lifecycle_stash_add(
    'standard_estimate:' || old.revision_id::text,
    jsonb_build_object(
      'option_id', old.option_id,
      'identity', '',
      'quantity', old.quantity,
      'variants', coalesce((
        select jsonb_agg(v.variant_choice_id order by v.variant_choice_id)
          from public.standard_estimate_revision_baseline_variants v
         where v.baseline_item_id = old.id
      ), '[]'::jsonb)
    )
  );
  return old;
end;
$$;

create function public.standard_estimate_baseline_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_entry jsonb;
  v_allowed jsonb;
begin
  select x.name, x.status, x.archived_at into o from public.options x where x.id = new.option_id for share;
  if not found or public.product_lifecycle_state(o.status, o.archived_at) <> 'retired' then
    return new; -- 標準見積ではシミュレーター非表示も使える
  end if;
  if tg_op = 'UPDATE' then
    if old.option_id = new.option_id and new.quantity <= old.quantity then
      return new;
    end if;
  else
    v_entry := public.product_lifecycle_stash_take('standard_estimate:' || new.revision_id::text, new.option_id, '', new.quantity);
    if v_entry is not null then
      -- 保持する明細の選択肢は、保存前の選択肢の範囲だけ（新しい選択肢は足せない）
      v_allowed := coalesce(nullif(current_setting('wing.product_lifecycle_variants', true), '')::jsonb, '{}'::jsonb);
      v_allowed := jsonb_set(v_allowed, array[new.id::text], coalesce(v_entry -> 'variants', '[]'::jsonb), true);
      perform set_config('wing.product_lifecycle_variants', v_allowed::text, true);
      return new;
    end if;
  end if;
  raise exception using errcode = 'P0001',
    message = format('RETIRED: 「%s」は取扱終了のため、標準状態に新しく入れられません（保存済みの明細は、削除・数量を減らす範囲でだけ残せます）', o.name);
end;
$$;

create function public.standard_estimate_baseline_variant_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option uuid;
  o record;
  v_allowed jsonb;
  v_list jsonb;
begin
  select b.option_id into v_option from public.standard_estimate_revision_baseline_items b where b.id = new.baseline_item_id;
  if not found then
    return new;
  end if;
  select x.status, x.archived_at, x.name into o from public.options x where x.id = v_option for share;
  if not found or public.product_lifecycle_state(o.status, o.archived_at) <> 'retired' then
    return new;
  end if;
  v_allowed := coalesce(nullif(current_setting('wing.product_lifecycle_variants', true), '')::jsonb, '{}'::jsonb);
  v_list := coalesce(v_allowed -> new.baseline_item_id::text, '[]'::jsonb);
  if not (v_list @> jsonb_build_array(new.variant_choice_id::text)) then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: 「%s」は取扱終了のため、選択肢を変えられません', o.name);
  end if;
  return new;
end;
$$;

create function public.standard_estimate_publish_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    perform 1
      from public.options o
     where o.id in (select b.option_id from public.standard_estimate_revision_baseline_items b where b.revision_id = new.id)
     order by o.id
     for share;
    select string_agg('「' || o.name || '」', '・' order by o.sort_order, o.id)
      into v_names
      from public.options o
     where o.id in (select b.option_id from public.standard_estimate_revision_baseline_items b where b.revision_id = new.id)
       and public.product_lifecycle_state(o.status, o.archived_at) = 'retired';
    if v_names is not null then
      raise exception using errcode = 'P0001',
        message = format('RETIRED: %s は取扱終了のため、この標準状態では公開できません。標準状態から外すか、取扱を再開してください', v_names);
    end if;
  end if;
  return new;
end;
$$;

create trigger standard_estimate_baseline_lifecycle_stash
before delete on public.standard_estimate_revision_baseline_items
for each row execute function public.standard_estimate_baseline_lifecycle_stash();

create trigger standard_estimate_baseline_lifecycle_guard
before insert or update of option_id, quantity on public.standard_estimate_revision_baseline_items
for each row execute function public.standard_estimate_baseline_lifecycle_guard();

create trigger standard_estimate_baseline_variant_lifecycle_guard
before insert on public.standard_estimate_revision_baseline_variants
for each row execute function public.standard_estimate_baseline_variant_lifecycle_guard();

create trigger standard_estimate_publish_lifecycle_guard
before update of status on public.standard_estimate_revisions
for each row execute function public.standard_estimate_publish_lifecycle_guard();

-- Excel 標準見積の基準商品：取扱終了の商品を新しく入れない（保存前と同じものは残せる）
create function public.estimate_templates_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text;
begin
  perform 1 from public.options o where o.id = any(coalesce(new.baseline_option_ids, '{}'::uuid[])) order by o.id for share;
  select string_agg('「' || o.name || '」', '・' order by o.sort_order, o.id)
    into v_names
    from public.options o
   where o.id = any(coalesce(new.baseline_option_ids, '{}'::uuid[]))
     and public.product_lifecycle_state(o.status, o.archived_at) = 'retired'
     and not (tg_op = 'UPDATE' and o.id = any(coalesce(old.baseline_option_ids, '{}'::uuid[])));
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('RETIRED: %s は取扱終了のため、基準商品に新しく入れられません', v_names);
  end if;
  return new;
end;
$$;

create trigger estimate_templates_lifecycle_guard
before insert or update of baseline_option_ids on public.estimate_templates
for each row execute function public.estimate_templates_lifecycle_guard();

-- ---------- 画面の機能を有効にしてよいか（この migration まで適用済みか） ----------

create function public.product_lifecycle_capability()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('columns', true, 'guards', true, 'version', 1);
$$;

-- ---------- 所有者と実行権限 ----------

alter function public.product_lifecycle_state(text, timestamptz) owner to postgres;
alter function public.product_lifecycle_sorted_ids(uuid[]) owner to postgres;
alter function public.product_lifecycle_stash_add(text, jsonb) owner to postgres;
alter function public.product_lifecycle_stash_take(text, uuid, text, numeric) owner to postgres;
alter function public.product_lifecycle_baseline_option_ids(uuid, text) owner to postgres;
alter function public.options_lifecycle_guard() owner to postgres;
alter function public.configuration_items_lifecycle_stash() owner to postgres;
alter function public.configuration_items_lifecycle_guard() owner to postgres;
alter function public.configurations_exterior_lifecycle_guard() owner to postgres;
alter function public.validate_configuration_items(uuid, uuid[], text) owner to postgres;
alter function public.quote_requests_lifecycle_guard() owner to postgres;
alter function public.quote_items_lifecycle_guard() owner to postgres;
alter function public.quote_draft_items_lifecycle_stash() owner to postgres;
alter function public.quote_draft_items_lifecycle_guard() owner to postgres;
alter function public.standard_estimate_baseline_lifecycle_stash() owner to postgres;
alter function public.standard_estimate_baseline_lifecycle_guard() owner to postgres;
alter function public.standard_estimate_baseline_variant_lifecycle_guard() owner to postgres;
alter function public.standard_estimate_publish_lifecycle_guard() owner to postgres;
alter function public.estimate_templates_lifecycle_guard() owner to postgres;
alter function public.product_lifecycle_capability() owner to postgres;

-- 内部用（トリガーと判定の部品は利用者から呼ばせない）
revoke all on function public.product_lifecycle_state(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.product_lifecycle_sorted_ids(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.product_lifecycle_stash_add(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.product_lifecycle_stash_take(text, uuid, text, numeric) from public, anon, authenticated, service_role;
revoke all on function public.product_lifecycle_baseline_option_ids(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.options_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.configuration_items_lifecycle_stash() from public, anon, authenticated, service_role;
revoke all on function public.configuration_items_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.configurations_exterior_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.quote_requests_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.quote_items_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.quote_draft_items_lifecycle_stash() from public, anon, authenticated, service_role;
revoke all on function public.quote_draft_items_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_baseline_lifecycle_stash() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_baseline_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_baseline_variant_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_publish_lifecycle_guard() from public, anon, authenticated, service_role;
revoke all on function public.estimate_templates_lifecycle_guard() from public, anon, authenticated, service_role;
-- validate_configuration_items は従来どおり（利用者から直接は呼ばせない）
revoke all on function public.validate_configuration_items(uuid, uuid[], text) from public, anon, authenticated, service_role;
-- 画面の機能判定だけ、ログインした利用者に許す
revoke all on function public.product_lifecycle_capability() from public, anon, authenticated, service_role;
grant execute on function public.product_lifecycle_capability() to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn record;
  v_trigger text;
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'product_lifecycle_state', 'product_lifecycle_sorted_ids', 'product_lifecycle_stash_add', 'product_lifecycle_stash_take',
         'product_lifecycle_baseline_option_ids', 'options_lifecycle_guard', 'configuration_items_lifecycle_stash',
         'configuration_items_lifecycle_guard', 'configurations_exterior_lifecycle_guard', 'quote_requests_lifecycle_guard',
         'quote_items_lifecycle_guard', 'quote_draft_items_lifecycle_stash', 'quote_draft_items_lifecycle_guard',
         'standard_estimate_baseline_lifecycle_stash', 'standard_estimate_baseline_lifecycle_guard',
         'standard_estimate_baseline_variant_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard',
         'estimate_templates_lifecycle_guard', 'product_lifecycle_capability'
       )
  loop
    if v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be owned by postgres', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon or service_role', v_fn.proname;
    end if;
    if v_fn.proname <> 'product_lifecycle_capability' and has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;
    end if;
  end loop;
  foreach v_trigger in array array[
    'options.options_lifecycle_guard', 'configuration_items.configuration_items_lifecycle_stash',
    'configuration_items.configuration_items_lifecycle_guard', 'configurations.configurations_exterior_lifecycle_guard',
    'quote_requests.quote_requests_lifecycle_guard', 'quote_items.quote_items_lifecycle_guard',
    'quote_draft_items.quote_draft_items_lifecycle_stash', 'quote_draft_items.quote_draft_items_lifecycle_guard',
    'standard_estimate_revision_baseline_items.standard_estimate_baseline_lifecycle_stash',
    'standard_estimate_revision_baseline_items.standard_estimate_baseline_lifecycle_guard',
    'standard_estimate_revision_baseline_variants.standard_estimate_baseline_variant_lifecycle_guard',
    'standard_estimate_revisions.standard_estimate_publish_lifecycle_guard', 'estimate_templates.estimate_templates_lifecycle_guard'
  ]
  loop
    if not exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = split_part(v_trigger, '.', 1) and t.tgname = split_part(v_trigger, '.', 2)
         and not t.tgisinternal and t.tgenabled <> 'D'
    ) then
      raise exception 'POSTCONDITION: trigger % is missing', v_trigger;
    end if;
  end loop;
end;
$postcondition$;

commit;
