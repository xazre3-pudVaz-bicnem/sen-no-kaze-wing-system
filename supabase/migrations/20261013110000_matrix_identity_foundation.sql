-- PR A：本体仕様マトリクスの識別子（Spec / Size / Matrix Item / Matrix Row / selectable）。
--
-- 統合版依頼書（2026-10-08）§4 の確定範囲：
--   * Spec（用途仕様）・Size（外形寸法）・Matrix Item（15 項目）・Matrix Row（機種 × 仕様 × サイズ）
--   * selectable（行 × 項目の選択可否。欠けているセルは選択不可として扱う＝fail closed）
--   * Category → Item の対応表は「表だけ」。初期の対応データは入れない（taxonomy の是正と対応づけは PR B）
--
-- 初期データは確定 seed（Matrix Item 15 項目・Matrix Row 6 行・選択可否 90 セル）だけを入れる。
-- 以後の変更は管理画面（PR D）で行う。マスターをコードに直書きしない。
--   * 防火は Matrix Item ではなく、Matrix Row の fire_selectable で扱う
--   * insulation / sitework / free-product / fireproof は Matrix Item に含めない
--   * hotel-single は新規登録しない（旧データの読み取り互換は PR B）
--
-- 既存のテーブル・データ（Configuration / Quote / Snapshot / Base Master / 標準見積）は変更しない。
-- 機種（base_models）が 1 つも無い DB（CI の空 DB）では行・セルの初期登録だけを省略する。
-- 機種が一部だけある・識別子が想定と違う場合は、何も変更せずに停止する。

begin;

-- ---------- tables ----------

create table public.matrix_specs (
  code text primary key check (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  label text not null check (btrim(label) <> '' and length(label) <= 40),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.matrix_specs is
  '本体仕様マトリクスの用途仕様（Spec）。code は configurations / estimate_templates の spec_code と同じ値を使う。';

create table public.matrix_sizes (
  code text primary key check (code ~ '^[1-9][0-9]{2,4}x[1-9][0-9]{2,4}$'),
  width_mm integer not null check (width_mm between 100 and 99999),
  depth_mm integer not null check (depth_mm between 100 and 99999),
  label text not null check (btrim(label) <> '' and length(label) <= 40),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matrix_sizes_code_matches_dimensions check (code = width_mm::text || 'x' || depth_mm::text)
);

comment on table public.matrix_sizes is '本体仕様マトリクスの外形寸法（Size）。code は「幅x奥行」（mm）。';

create table public.matrix_items (
  code text primary key check (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  label text not null check (btrim(label) <> '' and length(label) <= 40),
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.matrix_items is
  '本体仕様マトリクスの項目（Matrix Item）。防火・断熱・別途工事・自由商品は項目に含めない。';

create table public.matrix_rows (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  spec_code text not null references public.matrix_specs(code) on update restrict on delete restrict,
  size_code text not null references public.matrix_sizes(code) on update restrict on delete restrict,
  fire_selectable boolean not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  lock_version integer not null default 1 check (lock_version >= 1),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matrix_rows_identity_key unique (base_model_id, spec_code, size_code)
);

comment on table public.matrix_rows is
  '本体仕様マトリクスの行（機種 × 仕様 × サイズ）。fire_selectable = false の行では防火の本体を選べない。行は削除せず retired にする。';

create table public.matrix_cells (
  matrix_row_id uuid not null references public.matrix_rows(id) on delete restrict,
  matrix_item_code text not null references public.matrix_items(code) on update restrict on delete restrict,
  selectable boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (matrix_row_id, matrix_item_code)
);

comment on table public.matrix_cells is
  '本体仕様マトリクスの選択可否。セルが無い組み合わせは選択不可として扱う（fail closed）。';

create table public.option_category_matrix_items (
  category_id uuid primary key references public.option_categories(id) on delete restrict,
  matrix_item_code text not null references public.matrix_items(code) on update restrict on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.option_category_matrix_items is
  '商品カテゴリー → Matrix Item の対応（1 カテゴリー = 1 項目）。PR A では表だけを作り、対応データは PR B で登録する。';

create index matrix_rows_model_idx on public.matrix_rows(base_model_id, status);
create index matrix_cells_item_idx on public.matrix_cells(matrix_item_code);
create index option_category_matrix_items_item_idx on public.option_category_matrix_items(matrix_item_code);

create trigger trg_matrix_specs_updated before update on public.matrix_specs
  for each row execute function public.set_updated_at();
create trigger trg_matrix_sizes_updated before update on public.matrix_sizes
  for each row execute function public.set_updated_at();
create trigger trg_matrix_items_updated before update on public.matrix_items
  for each row execute function public.set_updated_at();
create trigger trg_matrix_rows_updated before update on public.matrix_rows
  for each row execute function public.set_updated_at();
create trigger trg_matrix_cells_updated before update on public.matrix_cells
  for each row execute function public.set_updated_at();
create trigger trg_option_category_matrix_items_updated before update on public.option_category_matrix_items
  for each row execute function public.set_updated_at();

-- ---------- RLS / ACL ----------
-- マトリクスは商品の公開情報（シミュレーターが未ログインでも参照する）。読み取りは誰でも、書き込みは API ロールから閉じる。
-- 管理画面からの変更は PR D の RPC（本部だけ・lock_version 付き）で行う。

alter table public.matrix_specs enable row level security;
alter table public.matrix_sizes enable row level security;
alter table public.matrix_items enable row level security;
alter table public.matrix_rows enable row level security;
alter table public.matrix_cells enable row level security;
alter table public.option_category_matrix_items enable row level security;

create policy matrix_specs_read on public.matrix_specs for select to anon, authenticated using (true);
create policy matrix_sizes_read on public.matrix_sizes for select to anon, authenticated using (true);
create policy matrix_items_read on public.matrix_items for select to anon, authenticated using (true);
create policy matrix_rows_read on public.matrix_rows for select to anon, authenticated using (true);
create policy matrix_cells_read on public.matrix_cells for select to anon, authenticated using (true);
create policy option_category_matrix_items_read on public.option_category_matrix_items for select to anon, authenticated using (true);

revoke all on public.matrix_specs, public.matrix_sizes, public.matrix_items, public.matrix_rows,
              public.matrix_cells, public.option_category_matrix_items
  from public, anon, authenticated;
grant select on public.matrix_specs, public.matrix_sizes, public.matrix_items, public.matrix_rows,
                public.matrix_cells, public.option_category_matrix_items
  to anon, authenticated;

-- ---------- initial data（確定 seed） ----------

insert into public.matrix_specs (code, label, sort_order) values
  ('hotel', 'ホテル仕様', 10),
  ('residence', '住居仕様', 20),
  ('office', '事務所仕様', 30),
  ('water-kit', '水回りBOX', 40);

insert into public.matrix_sizes (code, width_mm, depth_mm, label, sort_order) values
  ('3640x4550', 3640, 4550, '3,640×4,550', 10),
  ('2100x4550', 2100, 4550, '2,100×4,550', 20);

insert into public.matrix_items (code, label, sort_order) values
  ('roof-exterior', '屋根・外壁', 10),
  ('interior', '内装', 20),
  ('entrance-door', '玄関ドア', 30),
  ('sash', 'サッシ', 40),
  ('bath', 'UB・シャワー', 50),
  ('kitchen', 'キッチン', 60),
  ('washbasin', '洗面', 70),
  ('toilet', 'トイレ', 80),
  ('boiler', '給湯器', 90),
  ('entrance-storage', '玄関収納', 100),
  ('interior-door', '室内建具', 110),
  ('closet', 'クローゼット', 120),
  ('bed', 'ベッド', 130),
  ('furnishings', '備品', 140),
  ('other', 'その他', 150);

do $seed_rows$
declare
  v_models integer;
  v_missing text;
begin
  select count(*) into v_models from public.base_models;
  if v_models = 0 then
    raise notice 'MATRIX_SEED: base_models is empty; matrix rows / cells are not seeded (empty database)';
    return;
  end if;

  select string_agg(slug, ', ' order by slug) into v_missing
    from unnest(array['wing-01', 'box', 'flat']) as expected(slug)
   where not exists (select 1 from public.base_models m where m.slug = expected.slug);
  if v_missing is not null then
    raise exception 'MATRIX_SEED: base model(s) % are missing; review base_models before seeding the matrix', v_missing
      using errcode = 'P0001';
  end if;

  -- 選択できる項目を列挙する。列挙していない項目は selectable = false のセルとして明示的に入れる（全 15 項目）。
  with seed(model_slug, spec_code, size_code, fire_selectable, selectable_items) as (
    values
      ('wing-01', 'hotel', '3640x4550', true,
       array['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'washbasin', 'toilet', 'boiler',
             'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other']),
      ('wing-01', 'residence', '3640x4550', true,
       array['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet', 'boiler',
             'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other']),
      ('wing-01', 'office', '3640x4550', true,
       array['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'toilet', 'boiler',
             'furnishings', 'other']),
      ('box', 'hotel', '2100x4550', true,
       array['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'washbasin', 'toilet', 'boiler',
             'entrance-storage', 'interior-door', 'bed', 'furnishings', 'other']),
      ('box', 'water-kit', '2100x4550', true,
       array['roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet', 'boiler']),
      ('flat', 'office', '2100x4550', false,
       array['roof-exterior', 'interior', 'entrance-door', 'sash'])
  ),
  inserted as (
    insert into public.matrix_rows (base_model_id, spec_code, size_code, fire_selectable)
    select m.id, s.spec_code, s.size_code, s.fire_selectable
      from seed s
      join public.base_models m on m.slug = s.model_slug
    returning id, base_model_id, spec_code, size_code
  )
  insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
  select r.id, i.code, i.code = any(s.selectable_items)
    from inserted r
    join public.base_models m on m.id = r.base_model_id
    join seed s on s.model_slug = m.slug and s.spec_code = r.spec_code and s.size_code = r.size_code
   cross join public.matrix_items i;

  -- 列挙した項目名の打ち間違いは、選択可能なセルの数で検出する（打ち間違いはどのセルにも一致しない）
  if (select count(*) from public.matrix_cells where selectable) <> 13 + 14 + 10 + 13 + 9 + 4 then
    raise exception 'MATRIX_SEED: selectable cell count differs from the confirmed seed' using errcode = 'P0001';
  end if;
end;
$seed_rows$;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_table text;
begin
  if (select count(*) from public.matrix_items where status = 'active') <> 15
     or exists (select 1 from public.matrix_items where code in ('insulation', 'sitework', 'free-product', 'fireproof')) then
    raise exception 'POSTCONDITION: matrix_items must be exactly the confirmed 15 items';
  end if;

  if exists (select 1 from public.matrix_specs where code = 'hotel-single') then
    raise exception 'POSTCONDITION: hotel-single must not be seeded as a matrix spec';
  end if;

  if exists (select 1 from public.base_models) then
    if (select count(*) from public.matrix_rows) <> 6
       or (select count(*) from public.matrix_cells) <> 6 * 15
       or exists (
         select 1 from public.matrix_rows r
          where (select count(*) from public.matrix_cells c where c.matrix_row_id = r.id) <> 15
       )
       or not exists (
         select 1 from public.matrix_rows r join public.base_models m on m.id = r.base_model_id
          where m.slug = 'flat' and r.spec_code = 'office' and r.size_code = '2100x4550' and not r.fire_selectable
       )
       or (select count(*) from public.matrix_rows where fire_selectable) <> 5 then
      raise exception 'POSTCONDITION: matrix rows / cells differ from the confirmed seed (6 rows x 15 items, Flat office not fire selectable)';
    end if;
  end if;

  if exists (select 1 from public.option_category_matrix_items) then
    raise exception 'POSTCONDITION: category -> item mapping must not be seeded in PR A';
  end if;

  foreach v_table in array array['matrix_specs', 'matrix_sizes', 'matrix_items', 'matrix_rows', 'matrix_cells', 'option_category_matrix_items']
  loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'POSTCONDITION: RLS must be enabled on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       or has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('anon', 'public.' || v_table, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
       or not has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'POSTCONDITION: % must be read-only for API roles', v_table;
    end if;
  end loop;
end;
$postcondition$;

commit;
