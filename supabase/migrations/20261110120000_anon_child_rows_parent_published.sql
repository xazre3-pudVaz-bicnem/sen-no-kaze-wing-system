-- 選択グループ・選択肢・同時選択の制限・依存のルールの読み取りの条件を、親の商品（とグループ）の公開の状態にそろえる
-- （2026-11-13 の先方の依頼 A）
--
-- これまでの読み取りの条件は子の行の状態（status = 'published'）だけを見ていたので、親の商品・選択グループの状態も見る。
--
-- * option_variant_groups：匿名・お客様は「グループが公開中かつ親の商品が公開中」だけ
-- * option_variant_choices：匿名・お客様は「選択肢が公開中かつグループが公開中かつ親の商品が公開中」だけ
-- * option_conflicts・option_dependencies：匿名・お客様は「両方の商品が公開中」の行だけ
-- * 代理店以上（is_dealer()）・本部の範囲は、この migration では変えない。service_role は RLS の外
--
-- 親の公開状態は、options の id・status の列（匿名・ログイン利用者が読める。価格の列は C1b で読めない）と、options の読み取りの
-- 条件で確かめる。商品画像（option_images）と同じ形で、新しい関数・スキーマ・権限は足さない。
-- 公開サイト（lib/data/public-catalog.ts）は匿名の鍵で公開中の行を読んでいるため、表の読み取りの権限は外さない。
begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_expected constant jsonb := pg_catalog.jsonb_build_object(
    'option_variant_groups.variant_groups_read', '((status = ''published''::text) OR is_dealer())',
    'option_variant_choices.variant_choices_read', '((status = ''published''::text) OR is_dealer())',
    'option_conflicts.option_conflicts_read', 'true',
    'option_dependencies.option_dependencies_read', 'true');
  v_key text;
  v_actual text;
begin
  for v_key in select pg_catalog.jsonb_object_keys(v_expected) loop
    select pg_catalog.pg_get_expr(p.polqual, p.polrelid)
      into v_actual
      from pg_catalog.pg_policy p
     where p.polrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_key, '.', 1))
       and p.polname = pg_catalog.split_part(v_key, '.', 2)
       and p.polcmd = 'r'
       and p.polpermissive;
    if v_actual is distinct from (v_expected ->> v_key) then
      raise exception 'PRECONDITION: the read policy % is not as expected (%)', v_key, coalesce(v_actual, 'missing');
    end if;
  end loop;
  -- 親の公開状態を確かめるために、匿名・ログイン利用者が options の id・status と、選択グループの表を読めること
  if not (pg_catalog.has_column_privilege('anon', 'public.options', 'id', 'SELECT')
          and pg_catalog.has_column_privilege('anon', 'public.options', 'status', 'SELECT')
          and pg_catalog.has_column_privilege('authenticated', 'public.options', 'id', 'SELECT')
          and pg_catalog.has_column_privilege('authenticated', 'public.options', 'status', 'SELECT')
          and pg_catalog.has_table_privilege('anon', 'public.option_variant_groups', 'SELECT')
          and pg_catalog.has_table_privilege('authenticated', 'public.option_variant_groups', 'SELECT')) then
    raise exception 'PRECONDITION: anon/authenticated must be able to read options(id, status) and option_variant_groups';
  end if;
  if pg_catalog.has_column_privilege('anon', 'public.options', 'price', 'SELECT')
     or pg_catalog.has_column_privilege('anon', 'public.option_variant_choices', 'extra_price', 'SELECT') then
    raise exception 'PRECONDITION: the legacy price columns must stay hidden from anon (C1b)';
  end if;
end;
$preflight$;

alter policy variant_groups_read on public.option_variant_groups
  using (
    (status = 'published'
     and exists (select 1 from public.options o
                  where o.id = option_variant_groups.option_id and o.status = 'published'))
    or public.is_dealer());

alter policy variant_choices_read on public.option_variant_choices
  using (
    (status = 'published'
     and exists (select 1 from public.option_variant_groups g
                   join public.options o on o.id = g.option_id
                  where g.id = option_variant_choices.group_id and g.status = 'published' and o.status = 'published'))
    or public.is_dealer());

alter policy option_conflicts_read on public.option_conflicts
  using (
    public.is_dealer()
    or (exists (select 1 from public.options a where a.id = option_conflicts.option_id and a.status = 'published')
        and exists (select 1 from public.options b where b.id = option_conflicts.conflicts_with_option_id and b.status = 'published')));

alter policy option_dependencies_read on public.option_dependencies
  using (
    public.is_dealer()
    or (exists (select 1 from public.options a where a.id = option_dependencies.option_id and a.status = 'published')
        and exists (select 1 from public.options b where b.id = option_dependencies.requires_option_id and b.status = 'published')));

comment on policy variant_groups_read on public.option_variant_groups is
  '匿名・お客様はグループと親の商品がどちらも公開中の行だけ。代理店以上は今までどおり（2026-11-13 の先方の依頼 A）';
comment on policy variant_choices_read on public.option_variant_choices is
  '匿名・お客様は選択肢・グループ・親の商品がすべて公開中の行だけ。代理店以上は今までどおり（2026-11-13 の先方の依頼 A）';
comment on policy option_conflicts_read on public.option_conflicts is
  '匿名・お客様は両方の商品が公開中の行だけ。代理店以上は今までどおり（2026-11-13 の先方の依頼 A）';
comment on policy option_dependencies_read on public.option_dependencies is
  '匿名・お客様は両方の商品が公開中の行だけ。代理店以上は今までどおり（2026-11-13 の先方の依頼 A）';

do $postconditions$
declare
  v_name text;
  v_qual text;
begin
  for v_name, v_qual in
    select c.relname || '.' || p.polname, pg_catalog.pg_get_expr(p.polqual, p.polrelid)
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace
       and (c.relname, p.polname) in (('option_variant_groups', 'variant_groups_read'), ('option_variant_choices', 'variant_choices_read'),
                                      ('option_conflicts', 'option_conflicts_read'), ('option_dependencies', 'option_dependencies_read'))
  loop
    if pg_catalog.strpos(v_qual, 'options') = 0 or pg_catalog.strpos(v_qual, 'is_dealer()') = 0 then
      raise exception 'POSTCONDITION: the read policy % must check the parent options and keep is_dealer()', v_name;
    end if;
  end loop;
  if (select count(*) from pg_catalog.pg_policy p
       where p.polrelid in ('public.option_variant_groups'::regclass, 'public.option_variant_choices'::regclass,
                            'public.option_conflicts'::regclass, 'public.option_dependencies'::regclass)
         and p.polcmd = 'r') <> 4 then
    raise exception 'POSTCONDITION: each table must keep exactly one read policy';
  end if;
  if not (pg_catalog.has_table_privilege('anon', 'public.option_variant_groups', 'SELECT')
          and pg_catalog.has_table_privilege('anon', 'public.option_conflicts', 'SELECT')
          and pg_catalog.has_table_privilege('anon', 'public.option_dependencies', 'SELECT')
          and pg_catalog.has_column_privilege('anon', 'public.option_variant_choices', 'name', 'SELECT')) then
    raise exception 'POSTCONDITION: the public catalog (anon) must still be able to read these tables';
  end if;
end;
$postconditions$;

commit;
