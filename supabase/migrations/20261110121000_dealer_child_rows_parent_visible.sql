-- 代理店以上も、親の商品が読める子の行だけを読めるようにする（2026-11-16 の先方のご判断 2・H2-C ①）
--
-- 20261110120000 で、匿名・お客様は「親の商品（とグループ）が公開中」の子の行だけにした。代理店以上（is_dealer()）は、
-- 親の商品が読めるかどうかに関係なく、すべての子の行を読めた。子の行の見え方を、商品そのものの見え方にそろえる。
--
-- * 代理店（rank 1）：自分が読める商品（公開中の商品と、自社のフリー商品）の子の行だけ。子の行の状態は今までどおり問わない
-- * 総代理店・本部（商品台帳の編集者）：今までどおりすべて（商品をすべて読める。書き込みの条件 *_admin・variant_*_write も変えない）
-- * 匿名・お客様：20261110120000 のまま
--
-- 「親の商品が読める」は、options の読み取りの条件（options_read・options_admin）をそのまま使う。EXISTS の副問い合わせは、
-- 呼び出した人の権限と RLS で評価されるので、options の条件が変われば子の行もそれに合わせて変わる。
-- 既存の商品を組織に割り当てることはしない。新しい関数・スキーマ・権限は足さない。
begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_name text;
  v_qual text;
  v_count integer := 0;
begin
  -- 20261110120000 の後の形（親の公開の状態を見て、代理店以上は is_dealer() だけ）であること
  for v_name, v_qual in
    select c.relname || '.' || p.polname, pg_catalog.pg_get_expr(p.polqual, p.polrelid)
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace
       and p.polcmd = 'r'
       and p.polpermissive
       and (c.relname, p.polname) in (('option_variant_groups', 'variant_groups_read'), ('option_variant_choices', 'variant_choices_read'),
                                      ('option_conflicts', 'option_conflicts_read'), ('option_dependencies', 'option_dependencies_read'))
  loop
    v_count := v_count + 1;
    if pg_catalog.strpos(v_qual, 'options') = 0
       or pg_catalog.strpos(v_qual, 'is_dealer()') = 0
       or pg_catalog.strpos(v_qual, 'is_dealer() AND') > 0 then
      raise exception 'PRECONDITION: the read policy % is not in the 20261110120000 form (%)', v_name, v_qual;
    end if;
  end loop;
  if v_count <> 4 then
    raise exception 'PRECONDITION: expected 4 read policies, found %', v_count;
  end if;
  -- 商品の読み取りの条件が想定どおりであること（公開中か本部、または台帳の編集者か自社のフリー商品）
  if not exists (select 1 from pg_catalog.pg_policy p
                  where p.polrelid = 'public.options'::regclass and p.polname = 'options_read' and p.polcmd = 'r' and p.polpermissive)
     or not exists (select 1 from pg_catalog.pg_policy p
                     where p.polrelid = 'public.options'::regclass and p.polname = 'options_admin' and p.polcmd = '*' and p.polpermissive
                       and pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'can_edit_catalog()') > 0
                       and pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'owner_id = auth.uid()') > 0) then
    raise exception 'PRECONDITION: the options read policies are not as expected';
  end if;
  if not (pg_catalog.has_column_privilege('authenticated', 'public.options', 'id', 'SELECT')
          and pg_catalog.has_table_privilege('authenticated', 'public.option_variant_groups', 'SELECT')) then
    raise exception 'PRECONDITION: authenticated must be able to read options(id) and option_variant_groups';
  end if;
  -- 読み取りの条件から呼ぶ関数を、匿名・ログイン利用者が実行できること（できないと公開サイトの読み取りがエラーになる）
  if not (pg_catalog.has_function_privilege('anon', 'public.is_dealer()', 'EXECUTE')
          and pg_catalog.has_function_privilege('authenticated', 'public.is_dealer()', 'EXECUTE')
          and pg_catalog.has_function_privilege('authenticated', 'public.can_edit_catalog()', 'EXECUTE')) then
    raise exception 'PRECONDITION: anon/authenticated must be able to execute is_dealer() and can_edit_catalog()';
  end if;
end;
$preflight$;

alter policy variant_groups_read on public.option_variant_groups
  using (
    (status = 'published'
     and exists (select 1 from public.options o
                  where o.id = option_variant_groups.option_id and o.status = 'published'))
    or (public.is_dealer()
        and exists (select 1 from public.options o where o.id = option_variant_groups.option_id)));

alter policy variant_choices_read on public.option_variant_choices
  using (
    (status = 'published'
     and exists (select 1 from public.option_variant_groups g
                   join public.options o on o.id = g.option_id
                  where g.id = option_variant_choices.group_id and g.status = 'published' and o.status = 'published'))
    or (public.is_dealer()
        and exists (select 1 from public.option_variant_groups g
                      join public.options o on o.id = g.option_id
                     where g.id = option_variant_choices.group_id)));

alter policy option_conflicts_read on public.option_conflicts
  using (
    (exists (select 1 from public.options a where a.id = option_conflicts.option_id and a.status = 'published')
     and exists (select 1 from public.options b where b.id = option_conflicts.conflicts_with_option_id and b.status = 'published'))
    or (public.is_dealer()
        and exists (select 1 from public.options a where a.id = option_conflicts.option_id)
        and exists (select 1 from public.options b where b.id = option_conflicts.conflicts_with_option_id)));

alter policy option_dependencies_read on public.option_dependencies
  using (
    (exists (select 1 from public.options a where a.id = option_dependencies.option_id and a.status = 'published')
     and exists (select 1 from public.options b where b.id = option_dependencies.requires_option_id and b.status = 'published'))
    or (public.is_dealer()
        and exists (select 1 from public.options a where a.id = option_dependencies.option_id)
        and exists (select 1 from public.options b where b.id = option_dependencies.requires_option_id)));

comment on policy variant_groups_read on public.option_variant_groups is
  '匿名・お客様はグループと親の商品がどちらも公開中の行だけ。代理店以上は親の商品が読める行だけ（2026-11-16 のご判断 2・H2-C ①）';
comment on policy variant_choices_read on public.option_variant_choices is
  '匿名・お客様は選択肢・グループ・親の商品がすべて公開中の行だけ。代理店以上は親の商品が読める行だけ（2026-11-16 のご判断 2・H2-C ①）';
comment on policy option_conflicts_read on public.option_conflicts is
  '匿名・お客様は両方の商品が公開中の行だけ。代理店以上は両方の商品が読める行だけ（2026-11-16 のご判断 2・H2-C ①）';
comment on policy option_dependencies_read on public.option_dependencies is
  '匿名・お客様は両方の商品が公開中の行だけ。代理店以上は両方の商品が読める行だけ（2026-11-16 のご判断 2・H2-C ①）';

do $postconditions$
declare
  v_name text;
  v_qual text;
  v_all integer;
  v_and integer;
  v_fragment text;
  v_fragments text[];
begin
  for v_name, v_qual in
    select c.relname || '.' || p.polname, pg_catalog.pg_get_expr(p.polqual, p.polrelid)
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace
       and (c.relname, p.polname) in (('option_variant_groups', 'variant_groups_read'), ('option_variant_choices', 'variant_choices_read'),
                                      ('option_conflicts', 'option_conflicts_read'), ('option_dependencies', 'option_dependencies_read'))
  loop
    -- 代理店以上の枝が「is_dealer() かつ親が読める」になっていること（is_dealer() だけで通る枝が残っていないこと：
    -- is_dealer() の出現の数と「is_dealer() AND」の出現の数が同じで、1 以上）
    v_all := (pg_catalog.length(v_qual) - pg_catalog.length(pg_catalog.replace(v_qual, 'is_dealer()', ''))) / 11;
    v_and := (pg_catalog.length(v_qual) - pg_catalog.length(pg_catalog.replace(v_qual, 'is_dealer() AND', ''))) / 15;
    if v_and < 1 or v_all <> v_and or pg_catalog.strpos(v_qual, 'options') = 0 then
      raise exception 'POSTCONDITION: the read policy % must require a readable parent for dealers (%)', v_name, v_qual;
    end if;
    -- 親との結び付け（結合の列の取り違えが無いこと）
    v_fragments := case v_name
      when 'option_variant_groups.variant_groups_read' then
        array['o.id = option_variant_groups.option_id', 'o.status = ''published''::text']
      when 'option_variant_choices.variant_choices_read' then
        array['g.id = option_variant_choices.group_id', 'o.id = g.option_id', 'g.status = ''published''::text', 'o.status = ''published''::text']
      when 'option_conflicts.option_conflicts_read' then
        array['a.id = option_conflicts.option_id', 'b.id = option_conflicts.conflicts_with_option_id', 'a.status = ''published''::text', 'b.status = ''published''::text']
      else
        array['a.id = option_dependencies.option_id', 'b.id = option_dependencies.requires_option_id', 'a.status = ''published''::text', 'b.status = ''published''::text']
    end;
    foreach v_fragment in array v_fragments loop
      if pg_catalog.strpos(v_qual, v_fragment) = 0 then
        raise exception 'POSTCONDITION: the read policy % must contain % (%)', v_name, v_fragment, v_qual;
      end if;
    end loop;
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
