-- v2.5 PR-A1：商品の標準原価と、バリエーションの標準原価調整額を Version（変えられない履歴）で持つ。
--
-- 金額正本・価格ライフサイクル設計 v2.5 の第2章・第3章：
-- * 商品マスターの金額正本は標準原価（税別）。単純に上書きせず Version 履歴を残す
-- * 一度作った Version は変えない。訂正・変更は新しい Version を作る
-- * 同じ対象の「現在有効な Version」は同時に 1 つだけ（DB の不変条件）
-- * バリエーションは標準原価調整額（プラス・0・マイナス可）を Version で持つ。適用後の標準原価は 0 円未満にしない
--
-- 既存の本部商品基準原価（20261014110000：option_hq_standard_costs と set_option_hq_standard_cost）は、
-- 画面と呼び出し方を変えずに残す。RPC の中身だけを「新しい Version を作る」形に置き換え、
-- option_hq_standard_costs は現在の Version の写し（同じトランザクションで更新し、どの Version かを current_version_id で持つ）にする。
-- 既存 migration は編集しない。本番の option_hq_standard_costs は 0 件だが、行がある DB ではその値を Version 1 として移す。
--
-- 標準見積・シミュレーター・見積からの Version の固定（pin）は、後続の PR の責務（この migration では行わない）。

begin;

-- 原価の表と商品の行の lock を長く待たない。取れなければ migration ごと失敗し、何も変わらない
set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.option_hq_standard_costs') is null
     or to_regprocedure('public.set_option_hq_standard_cost(uuid, integer, integer, text)') is null
     or to_regprocedure('public.can_view_option_hq_standard_cost()') is null
     or to_regprocedure('public.can_manage_option_hq_standard_cost()') is null then
    raise exception 'PRECONDITION: HQ standard cost (20261014110000) must be applied first';
  end if;
  if to_regclass('public.option_standard_cost_versions') is not null
     or to_regclass('public.option_variant_cost_versions') is not null then
    raise exception 'PRECONDITION: standard cost version tables already exist';
  end if;
end;
$preflight$;

-- ---------- 商品の標準原価 Version ----------

create table public.option_standard_cost_versions (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  standard_cost integer not null check (standard_cost >= 0),
  change_reason text not null check (pg_catalog.char_length(pg_catalog.btrim(change_reason)) between 1 and 500),
  -- 監査の参照（Version を変えないため、利用者の削除で書き換わる外部キーにはしない）
  created_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  constraint option_standard_cost_versions_option_version_key unique (option_id, version_no),
  constraint option_standard_cost_versions_superseded_pair check ((superseded_at is null) = (superseded_by_version_id is null)),
  constraint option_standard_cost_versions_superseded_after check (superseded_at is null or superseded_at >= created_at),
  -- 新しい Version を作る前に古い Version を閉じるため、同じトランザクションの終わりで確かめる
  constraint option_standard_cost_versions_superseded_by_fkey foreign key (superseded_by_version_id)
    references public.option_standard_cost_versions(id) deferrable initially deferred
);

comment on table public.option_standard_cost_versions is
  '商品の標準原価（税別）の Version。作った後は変えない。変更は新しい Version を作り、現在の Version を閉じる（superseded_at）。';

-- 現在有効な Version は 1 商品 1 つだけ
create unique index option_standard_cost_versions_current_key
  on public.option_standard_cost_versions (option_id)
  where superseded_at is null;

-- ---------- バリエーション（選択肢）の標準原価調整額 Version ----------

create table public.option_variant_cost_versions (
  id uuid primary key default gen_random_uuid(),
  variant_choice_id uuid not null references public.option_variant_choices(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  cost_adjustment integer not null check (cost_adjustment between -100000000 and 100000000),
  change_reason text not null check (pg_catalog.char_length(pg_catalog.btrim(change_reason)) between 1 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_version_id uuid,
  constraint option_variant_cost_versions_choice_version_key unique (variant_choice_id, version_no),
  constraint option_variant_cost_versions_superseded_pair check ((superseded_at is null) = (superseded_by_version_id is null)),
  constraint option_variant_cost_versions_superseded_after check (superseded_at is null or superseded_at >= created_at),
  constraint option_variant_cost_versions_superseded_by_fkey foreign key (superseded_by_version_id)
    references public.option_variant_cost_versions(id) deferrable initially deferred
);

comment on table public.option_variant_cost_versions is
  'バリエーション（選択肢）の標準原価調整額（税別、プラス・0・マイナス可）の Version。作った後は変えない。';

create unique index option_variant_cost_versions_current_key
  on public.option_variant_cost_versions (variant_choice_id)
  where superseded_at is null;

-- ---------- Version を変えさせない ----------

-- 変えてよいのは、現在の Version を閉じるときの superseded_at・superseded_by_version_id（空 → 値、1 回だけ）。削除はさせない
create function public.standard_cost_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 標準原価の Version は削除できません（変更は新しい Version を作ります）';
  end if;
  if old.superseded_at is not null
     or new.superseded_at is null
     or new.superseded_by_version_id is null
     or (pg_catalog.to_jsonb(new) - 'superseded_at' - 'superseded_by_version_id')
        is distinct from (pg_catalog.to_jsonb(old) - 'superseded_at' - 'superseded_by_version_id') then
    raise exception using errcode = 'P0001',
      message = 'LOCKED: 標準原価の Version は変更できません（変更は新しい Version を作ります）';
  end if;
  return new;
end;
$$;

create trigger option_standard_cost_versions_immutable
before update or delete on public.option_standard_cost_versions
for each row execute function public.standard_cost_version_immutable();

create trigger option_variant_cost_versions_immutable
before update or delete on public.option_variant_cost_versions
for each row execute function public.standard_cost_version_immutable();

-- ---------- 読み取り（本部だけ）。書き込みは RPC だけ ----------

alter table public.option_standard_cost_versions enable row level security;
alter table public.option_variant_cost_versions enable row level security;
revoke all on table public.option_standard_cost_versions from public, anon, authenticated, service_role;
revoke all on table public.option_variant_cost_versions from public, anon, authenticated, service_role;
grant select on table public.option_standard_cost_versions to authenticated;
grant select on table public.option_variant_cost_versions to authenticated;

create policy option_standard_cost_versions_hq_read
on public.option_standard_cost_versions
for select
to authenticated
using (public.can_view_option_hq_standard_cost());

create policy option_variant_cost_versions_hq_read
on public.option_variant_cost_versions
for select
to authenticated
using (public.can_view_option_hq_standard_cost());

-- ---------- 既存の本部商品基準原価を、現在の Version の写しにする ----------

alter table public.option_hq_standard_costs
  add column current_version_id uuid references public.option_standard_cost_versions(id) on delete restrict;

-- 既存の値を Version 1 として移す（本番は 0 件）
insert into public.option_standard_cost_versions (option_id, version_no, standard_cost, change_reason, created_by, created_at)
select c.option_id, 1, c.standard_cost, '既存の本部商品基準原価から移行（v2.5 の Version 管理の開始）', c.updated_by, c.updated_at
  from public.option_hq_standard_costs c;

update public.option_hq_standard_costs c
   set current_version_id = v.id
  from public.option_standard_cost_versions v
 where v.option_id = c.option_id
   and v.superseded_at is null;

alter table public.option_hq_standard_costs
  alter column current_version_id set not null;

create unique index option_hq_standard_costs_current_version_key
  on public.option_hq_standard_costs (current_version_id);

comment on column public.option_hq_standard_costs.current_version_id is
  'この行が写している現在の標準原価 Version（option_standard_cost_versions）。RPC が同じトランザクションで更新する。';

-- ---------- 適用後の標準原価が 0 円未満にならないかの確認（内部の部品） ----------

-- 各選択項目で最も小さい（マイナスの）調整額を足した、いちばん低い組み合わせの調整額の合計（0 以下）。
-- p_choice_id の調整額を p_adjustment に置き換えた場合を計算できる（未設定の選択肢は 0 円の調整として扱う）。
-- 必須・任意や選択肢の公開状態は後から変わりうるため、それらに関係なく、どの選び方でも下回らない下限で確かめる
-- （必須項目のプラスの調整額で相殺される組み合わせも拒否するので、v2.5 の条件より厳しい側に倒している）。
-- 2 つの設定 RPC（商品の行を lock した後）からだけ呼ぶ
create function public.option_variant_cost_min_total(p_option_id uuid, p_choice_id uuid default null, p_adjustment integer default null)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(g.min_adjustment), 0)::bigint
    from (
      select least(min(case when vc.id = p_choice_id then p_adjustment else coalesce(v.cost_adjustment, 0) end), 0) as min_adjustment
        from public.option_variant_groups vg
        join public.option_variant_choices vc on vc.group_id = vg.id
        left join public.option_variant_cost_versions v on v.variant_choice_id = vc.id and v.superseded_at is null
       where vg.option_id = p_option_id
       group by vg.id
    ) g;
$$;

-- ---------- 本部商品基準原価の設定（同じ呼び出し方のまま、新しい Version を作る） ----------

create or replace function public.set_option_hq_standard_cost(
  p_option_id uuid,
  p_standard_cost integer,
  p_expected_lock_version integer,
  p_change_reason text
)
returns table (
  option_id uuid,
  standard_cost integer,
  lock_version integer,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := pg_catalog.btrim(coalesce(p_change_reason, ''));
  v_option public.options%rowtype;
  v_current public.option_hq_standard_costs%rowtype;
  v_next public.option_hq_standard_costs%rowtype;
  v_version public.option_standard_cost_versions%rowtype;
  v_new_version public.option_standard_cost_versions%rowtype;
  v_new_id uuid := pg_catalog.gen_random_uuid();
  v_actor_email text;
  v_has_current boolean := false;
  v_has_version boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;

  if not public.can_manage_option_hq_standard_cost() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 本部商品基準原価を変更する権限がありません';
  end if;

  if p_option_id is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品IDがありません';
  end if;
  if p_standard_cost is null or p_standard_cost < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部商品基準原価は0円以上で入力してください';
  end if;
  if p_expected_lock_version is null or p_expected_lock_version < 0 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 読み込んだ版が不正です';
  end if;
  if pg_catalog.char_length(v_reason) < 1 or pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 変更理由は1〜500文字で入力してください';
  end if;

  -- 商品削除RPCとのlock順序を揃えるため、必ずoptionsを先にロックする。
  select *
    into v_option
  from public.options o
  where o.id = p_option_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 商品が見つかりません';
  end if;
  if v_option.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この状態の商品には本部商品基準原価を設定できません';
  end if;

  select *
    into v_current
  from public.option_hq_standard_costs c
  where c.option_id = p_option_id
  for update;
  v_has_current := found;

  -- 写しの版（lock_version）が古ければ、Version を作らずに止める（後勝ちにしない）
  if (not v_has_current and p_expected_lock_version <> 0)
     or (v_has_current and v_current.lock_version <> p_expected_lock_version) then
    raise exception using errcode = 'P0001', message = 'CONFLICT: 本部商品基準原価が他の担当者によって変更されています。再読み込みしてください';
  end if;

  -- 同額かつversion一致はno-op。履歴もversionも増やさない。
  if v_has_current and v_current.standard_cost = p_standard_cost then
    return query select v_current.option_id, v_current.standard_cost, v_current.lock_version, false, v_current.updated_at;
    return;
  end if;

  -- どのバリエーションの組み合わせでも、適用後の標準原価を 0 円未満にしない
  if p_standard_cost + public.option_variant_cost_min_total(p_option_id) < 0 then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: バリエーションの標準原価調整額を適用すると0円未満になる組み合わせがあります。調整額を見直してから設定してください';
  end if;

  select p.email into v_actor_email
  from public.profiles p
  where p.id = v_actor;

  -- 現在の Version を閉じてから、新しい Version を作る（現在有効は常に 1 つ）
  select *
    into v_version
  from public.option_standard_cost_versions v
  where v.option_id = p_option_id
    and v.superseded_at is null
  for update;
  v_has_version := found;

  if v_has_current and not v_has_version then
    raise exception using errcode = 'P0001', message = 'INTERNAL: 本部商品基準原価の現在の Version が見つかりません';
  end if;

  if v_has_version then
    update public.option_standard_cost_versions v
       set superseded_at = now(),
           superseded_by_version_id = v_new_id
     where v.id = v_version.id;
  end if;

  insert into public.option_standard_cost_versions (id, option_id, version_no, standard_cost, change_reason, created_by)
  values (
    v_new_id,
    p_option_id,
    coalesce((select max(v.version_no) from public.option_standard_cost_versions v where v.option_id = p_option_id), 0) + 1,
    p_standard_cost,
    v_reason,
    v_actor
  )
  returning * into v_new_version;

  if not v_has_current then
    insert into public.option_hq_standard_costs (
      option_id, standard_cost, lock_version, created_by, created_at, updated_by, updated_at, current_version_id
    ) values (
      p_option_id, p_standard_cost, 1, v_actor, now(), v_actor, now(), v_new_id
    )
    returning * into v_next;

    insert into public.audit_logs (
      actor_id, actor_email, action, entity, entity_id, summary, before, after
    ) values (
      v_actor,
      v_actor_email,
      'hq_standard_cost_set',
      'option_hq_standard_cost',
      p_option_id,
      '本部商品基準原価を設定',
      null,
      pg_catalog.jsonb_build_object(
        'standard_cost', v_next.standard_cost,
        'lock_version', v_next.lock_version,
        'version_no', v_new_version.version_no,
        'version_id', v_new_version.id,
        'product_no', v_option.product_no,
        'product_name', v_option.name,
        'actor_id', v_actor,
        'change_reason', v_reason
      )
    );

    return query select v_next.option_id, v_next.standard_cost, v_next.lock_version, true, v_next.updated_at;
    return;
  end if;

  update public.option_hq_standard_costs c
  set standard_cost = p_standard_cost,
      lock_version = c.lock_version + 1,
      updated_by = v_actor,
      updated_at = now(),
      current_version_id = v_new_id
  where c.option_id = p_option_id
  returning * into v_next;

  insert into public.audit_logs (
    actor_id, actor_email, action, entity, entity_id, summary, before, after
  ) values (
    v_actor,
    v_actor_email,
    'hq_standard_cost_update',
    'option_hq_standard_cost',
    p_option_id,
    '本部商品基準原価を変更',
    pg_catalog.jsonb_build_object(
      'standard_cost', v_current.standard_cost,
      'lock_version', v_current.lock_version,
      'version_no', v_version.version_no,
      'version_id', v_version.id,
      'product_no', v_option.product_no,
      'product_name', v_option.name,
      'actor_id', v_actor
    ),
    pg_catalog.jsonb_build_object(
      'standard_cost', v_next.standard_cost,
      'lock_version', v_next.lock_version,
      'version_no', v_new_version.version_no,
      'version_id', v_new_version.id,
      'product_no', v_option.product_no,
      'product_name', v_option.name,
      'actor_id', v_actor,
      'change_reason', v_reason
    )
  );

  return query select v_next.option_id, v_next.standard_cost, v_next.lock_version, true, v_next.updated_at;
end;
$$;

-- ---------- バリエーションの標準原価調整額の設定（本部だけ） ----------

-- 期待した現在の Version（未設定なら null）と一致するときだけ、現在の Version を閉じて新しい Version を作る
create function public.set_option_variant_cost_adjustment(
  p_variant_choice_id uuid,
  p_cost_adjustment integer,
  p_expected_current_version_id uuid,
  p_change_reason text
)
returns table (
  variant_choice_id uuid,
  version_id uuid,
  version_no integer,
  cost_adjustment integer,
  changed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := pg_catalog.btrim(coalesce(p_change_reason, ''));
  v_option_id uuid;
  v_option public.options%rowtype;
  v_choice_name text;
  v_current public.option_variant_cost_versions%rowtype;
  v_has_current boolean := false;
  v_new public.option_variant_cost_versions%rowtype;
  v_new_id uuid := pg_catalog.gen_random_uuid();
  v_product_cost integer;
  v_actor_email text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.can_manage_option_hq_standard_cost() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 標準原価調整額を変更する権限がありません';
  end if;

  if p_variant_choice_id is null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 選択肢IDがありません';
  end if;
  if p_cost_adjustment is null or p_cost_adjustment < -100000000 or p_cost_adjustment > 100000000 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 標準原価調整額は-100,000,000〜100,000,000円で入力してください';
  end if;
  if pg_catalog.char_length(v_reason) < 1 or pg_catalog.char_length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 変更理由は1〜500文字で入力してください';
  end if;

  select vg.option_id, vc.name
    into v_option_id, v_choice_name
  from public.option_variant_choices vc
  join public.option_variant_groups vg on vg.id = vc.group_id
  where vc.id = p_variant_choice_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 選択肢が見つかりません';
  end if;

  -- 商品の標準原価・商品削除と同じ順序で、商品の行を先に lock する
  select *
    into v_option
  from public.options o
  where o.id = v_option_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 商品が見つかりません';
  end if;
  if v_option.status not in ('draft', 'published') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この状態の商品には標準原価調整額を設定できません';
  end if;

  select *
    into v_current
  from public.option_variant_cost_versions v
  where v.variant_choice_id = p_variant_choice_id
    and v.superseded_at is null
  for update;
  v_has_current := found;

  if p_expected_current_version_id is distinct from (case when v_has_current then v_current.id end) then
    raise exception using errcode = 'P0001', message = 'CONFLICT: 標準原価調整額が他の担当者によって変更されています。再読み込みしてください';
  end if;

  if v_has_current and v_current.cost_adjustment = p_cost_adjustment then
    return query select v_current.variant_choice_id, v_current.id, v_current.version_no, v_current.cost_adjustment, false, v_current.created_at;
    return;
  end if;

  -- 商品の標準原価があれば、どの組み合わせでも適用後の標準原価を 0 円未満にしない
  select v.standard_cost
    into v_product_cost
  from public.option_standard_cost_versions v
  where v.option_id = v_option_id
    and v.superseded_at is null;
  if v_product_cost is not null
     and v_product_cost + public.option_variant_cost_min_total(v_option_id, p_variant_choice_id, p_cost_adjustment) < 0 then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 適用後の標準原価が0円未満になる組み合わせがあります。調整額を見直してください';
  end if;

  if v_has_current then
    update public.option_variant_cost_versions v
       set superseded_at = now(),
           superseded_by_version_id = v_new_id
     where v.id = v_current.id;
  end if;

  insert into public.option_variant_cost_versions (id, variant_choice_id, version_no, cost_adjustment, change_reason, created_by)
  values (
    v_new_id,
    p_variant_choice_id,
    coalesce((select max(v.version_no) from public.option_variant_cost_versions v where v.variant_choice_id = p_variant_choice_id), 0) + 1,
    p_cost_adjustment,
    v_reason,
    v_actor
  )
  returning * into v_new;

  select p.email into v_actor_email
  from public.profiles p
  where p.id = v_actor;

  insert into public.audit_logs (
    actor_id, actor_email, action, entity, entity_id, summary, before, after
  ) values (
    v_actor,
    v_actor_email,
    case when v_has_current then 'variant_standard_cost_update' else 'variant_standard_cost_set' end,
    'option_variant_cost',
    v_option_id,
    case when v_has_current then '標準原価調整額を変更' else '標準原価調整額を設定' end,
    case when v_has_current then pg_catalog.jsonb_build_object(
      'variant_choice_id', p_variant_choice_id,
      'cost_adjustment', v_current.cost_adjustment,
      'version_no', v_current.version_no,
      'version_id', v_current.id
    ) end,
    pg_catalog.jsonb_build_object(
      'variant_choice_id', p_variant_choice_id,
      'variant_choice_name', v_choice_name,
      'cost_adjustment', v_new.cost_adjustment,
      'version_no', v_new.version_no,
      'version_id', v_new.id,
      'product_no', v_option.product_no,
      'product_name', v_option.name,
      'actor_id', v_actor,
      'change_reason', v_reason
    )
  );

  return query select v_new.variant_choice_id, v_new.id, v_new.version_no, v_new.cost_adjustment, true, v_new.created_at;
end;
$$;

-- ---------- 所有者と実行権限 ----------

alter function public.standard_cost_version_immutable() owner to postgres;
alter function public.option_variant_cost_min_total(uuid, uuid, integer) owner to postgres;
alter function public.set_option_hq_standard_cost(uuid, integer, integer, text) owner to postgres;
alter function public.set_option_variant_cost_adjustment(uuid, integer, uuid, text) owner to postgres;

revoke all on function public.standard_cost_version_immutable() from public, anon, authenticated, service_role;
revoke all on function public.option_variant_cost_min_total(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.set_option_hq_standard_cost(uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.set_option_variant_cost_adjustment(uuid, integer, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_option_hq_standard_cost(uuid, integer, integer, text) to authenticated;
grant execute on function public.set_option_variant_cost_adjustment(uuid, integer, uuid, text) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_table text;
  v_fn record;
begin
  foreach v_table in array array['option_standard_cost_versions', 'option_variant_cost_versions'] loop
    if not exists (select 1 from pg_class c where c.oid = ('public.' || v_table)::regclass and c.relrowsecurity) then
      raise exception 'POSTCONDITION: % RLS is not enabled', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('service_role', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'POSTCONDITION: anon or service_role retains % privileges', v_table;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'POSTCONDITION: authenticated % ACL is not SELECT-only', v_table;
    end if;
    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal and t.tgenabled <> 'D'
         and t.tgname = v_table || '_immutable'
    ) then
      raise exception 'POSTCONDITION: % immutability trigger is missing', v_table;
    end if;
  end loop;

  if to_regclass('public.option_standard_cost_versions_current_key') is null
     or to_regclass('public.option_variant_cost_versions_current_key') is null then
    raise exception 'POSTCONDITION: current version unique index is missing';
  end if;

  -- 写しは、すべて現在の Version と同じ値を指す
  if exists (
    select 1
      from public.option_hq_standard_costs c
      left join public.option_standard_cost_versions v on v.id = c.current_version_id
     where v.id is null or v.superseded_at is not null or v.option_id <> c.option_id or v.standard_cost <> c.standard_cost
  ) then
    raise exception 'POSTCONDITION: option_hq_standard_costs must mirror the current standard cost version';
  end if;

  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('standard_cost_version_immutable', 'option_variant_cost_min_total',
                         'set_option_hq_standard_cost', 'set_option_variant_cost_adjustment')
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
    if v_fn.proname in ('set_option_hq_standard_cost', 'set_option_variant_cost_adjustment') then
      if not v_fn.prosecdef or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: % must be SECURITY DEFINER and executable by authenticated', v_fn.proname;
      end if;
    elsif has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: internal function % must not be executable by authenticated', v_fn.proname;
    end if;
  end loop;
end;
$postcondition$;

commit;
