-- Issue #707: split air conditioning and lighting from the shared "other" matrix item.
-- Business decision (2026-11-23): initialize each new flag to the existing row's "other"
-- selectable flag. Existing "other", category visibility, pricing, and issued history stay unchanged.
-- All steps are atomic; preflight mismatches abort without a partial cutover.
-- Production execution requires a separate operator preflight / independent review.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Serialize this cutover against the matrix admin RPCs and category mapping writers.
-- EXCLUSIVE (not SHARE ROW EXCLUSIVE): unlike SHARE ROW EXCLUSIVE, it also conflicts with
-- the ROW SHARE lock that update_matrix_row / set_matrix_row_status take first
-- (SELECT ... FOR UPDATE); both modes conflict with create_matrix_row's insert. So a save
-- that starts during the cutover waits for it and then sees the bumped lock_version.
-- Plain reads (simulator catalog, configuration category guards, v2.5 checks) are
-- ACCESS SHARE and are not blocked.
-- Lock order: matrix_rows first (every admin writer touches it before the other three
-- tables, holding at most ACCESS SHARE on them), matrix_items last (it is only reached by
-- writers through foreign-key checks from matrix_cells / option_category_matrix_items).
-- A writer that already holds a lock on an earlier table can therefore always finish
-- before the cutover takes the later ones, so the two never wait on each other in a cycle.
-- lock_timeout aborts the whole cutover if a writer keeps a conflicting lock.
lock table public.matrix_rows, public.matrix_cells, public.option_category_matrix_items,
  public.matrix_items in exclusive mode;

do $preflight$
declare
  v_empty boolean;
begin
  -- Existing foundation intentionally skips row and category mapping seed for
  -- completely empty databases. Accept that state ONLY when both models and
  -- products are empty; partial/prod data must pass the audited 6x15 baseline.
  v_empty := not exists (select 1 from public.base_models)
             and not exists (select 1 from public.options);
  if (select count(*) from public.matrix_items) <> 15
    or (select count(*) from public.matrix_items where status = 'active') <> 15
    or exists (select 1 from public.matrix_items where code in ('aircon', 'lighting')) then
    raise exception 'STOP 707: expected exactly 15 active legacy matrix items';
  end if;

  if v_empty then
    if exists (select 1 from public.matrix_rows)
      or exists (select 1 from public.matrix_cells)
      or exists (select 1 from public.option_category_matrix_items) then
      raise exception 'STOP 707: empty database has partial matrix rows/cells/mapping';
    end if;
  else
    if (select count(*) from public.matrix_rows) <> 6
      or (select count(*) from public.matrix_rows where status = 'active') <> 6
      or (select count(*) from public.matrix_cells) <> 90
      or (select count(*) from public.matrix_cells where matrix_item_code = 'other') <> 6
      or (select count(*) from public.matrix_cells where matrix_item_code = 'other' and selectable) <> 4
      or exists (
        select 1 from public.matrix_rows r
         where (select count(*) from public.matrix_cells c where c.matrix_row_id = r.id) <> 15
      ) then
      raise exception 'STOP 707: legacy matrix rows/cells differ from audited baseline (6 x 15; other=true 4)';
    end if;

    if (select count(*) from public.option_category_matrix_items) <> 24
      or (select count(*)
            from public.option_category_matrix_items x
            join public.option_categories c on c.id = x.category_id
           where c.code in ('aircon', 'lighting', 'smartlock', 'exterior-parts')
             and x.matrix_item_code = 'other') <> 4 then
      raise exception 'STOP 707: expected the four categories mapped to other';
    end if;

    if not exists(select 1 from public.option_categories where code='aircon' and status='published')
      or not exists(select 1 from public.option_categories where code='lighting' and status='published') then
      raise exception 'STOP 707: aircon and lighting must exist as published categories';
    end if;
  end if;
end;
$preflight$;

-- Capture the pre-cutover business result for every category (not only the four
-- "other" categories), including BOX hotel-single and "base" aliases.
create temporary table matrix_707_before on commit drop as
  with target_specs as (
    select distinct m.slug as model_slug, r.spec_code
      from public.matrix_rows r
      join public.base_models m on m.id = r.base_model_id
    union
    select 'box', 'hotel-single'
    union
    select slug, 'base' from public.base_models
      where slug in ('wing-01', 'box', 'flat')
  )
  select t.model_slug, t.spec_code, c.code as category_code,
         public.customer_category_selectable(t.model_slug, t.spec_code, c.code) as was_selectable
    from target_specs t
    cross join public.option_categories c;

-- Keep the existing other cell values as a separate before-image.
create temporary table matrix_707_other_before on commit drop as
  select matrix_row_id, selectable
    from public.matrix_cells
   where matrix_item_code = 'other';

-- Full before-images: existing items, rows, cells and category mappings must not change,
-- except for the two new items and their cells, the two remapped categories and the
-- row lock_version bump.
create temporary table matrix_707_items_before on commit drop as
  select code, label, sort_order, status from public.matrix_items;
create temporary table matrix_707_rows_before on commit drop as
  select id, base_model_id, spec_code, size_code, fire_selectable, status, lock_version
    from public.matrix_rows;
create temporary table matrix_707_cells_before on commit drop as
  select matrix_row_id, matrix_item_code, selectable from public.matrix_cells;
create temporary table matrix_707_mapping_before on commit drop as
  select category_id, matrix_item_code from public.option_category_matrix_items;

insert into public.matrix_items (code, label, sort_order, status)
values ('aircon', '空調（エアコン）', 145, 'active'),
       ('lighting', '照明器具', 146, 'active');

-- Existing row's other flag is the confirmed initialization rule for BOTH new items.
insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
select c.matrix_row_id, i.code, c.selectable
  from public.matrix_cells c
  cross join (values ('aircon'), ('lighting')) as i(code)
 where c.matrix_item_code = 'other';

-- Move only the two requested categories. Smart lock and exterior parts remain other.
update public.option_category_matrix_items x
   set matrix_item_code = c.code
  from public.option_categories c
 where x.category_id = c.id
   and c.code in ('aircon','lighting')
   and x.matrix_item_code = 'other';

-- Old open 15-column clients must not be permitted to overwrite new flags:
-- update_matrix_row checks expected_lock_version under SELECT FOR UPDATE.
update public.matrix_rows
   set lock_version = lock_version + 1;

do $postflight$
begin
  if (select count(*) from public.matrix_items where status = 'active') <> 17
    or (select count(*) from public.matrix_rows) not in (0, 6)
    or (select count(*) from public.matrix_cells) <>
       (select count(*) from public.matrix_rows) * 17
    or exists (
      select 1 from public.matrix_rows r
       where (select count(*) from public.matrix_cells c where c.matrix_row_id = r.id) <> 17
    ) then
    raise exception 'STOP 707: item/row/cell count mismatch after split';
  end if;

  if (select count(*) from public.option_category_matrix_items) <>
       (case when (select count(*) from public.matrix_rows) = 0 then 0 else 24 end)
    or exists (
      select 1 from public.option_categories c
      join public.option_category_matrix_items x on x.category_id=c.id
      where (c.code='aircon' and x.matrix_item_code<>'aircon')
         or (c.code='lighting' and x.matrix_item_code<>'lighting')
         or (c.code in ('smartlock','exterior-parts') and x.matrix_item_code<>'other')
    ) then
    raise exception 'STOP 707: category mapping mismatch after split';
  end if;

  -- With data, exactly one category maps to each new item (the published aircon / lighting
  -- categories). option_categories is not locked, so a concurrent code change must not let
  -- the remap silently miss a category.
  if (select count(*) from public.matrix_rows) > 0 and (
       (select count(*) from public.option_category_matrix_items x
          join public.option_categories c on c.id = x.category_id
         where x.matrix_item_code = 'aircon' and c.code = 'aircon') <> 1
    or (select count(*) from public.option_category_matrix_items x
          join public.option_categories c on c.id = x.category_id
         where x.matrix_item_code = 'lighting' and c.code = 'lighting') <> 1
    or exists (select 1 from public.option_category_matrix_items x
                where x.matrix_item_code in ('aircon', 'lighting')
                  and not exists (select 1 from public.option_categories c
                                   where c.id = x.category_id and c.code = x.matrix_item_code))) then
    raise exception 'STOP 707: aircon / lighting categories were not remapped exactly once';
  end if;

  if exists (
    select 1 from pg_temp.matrix_707_other_before b
    join public.matrix_cells c on c.matrix_row_id=b.matrix_row_id
      and c.matrix_item_code in ('other','aircon','lighting')
    where c.selectable is distinct from b.selectable
  ) then
    raise exception 'STOP 707: new items or old other differ from the approved initialization';
  end if;

  -- The 15 existing items keep code/label/order/status; only aircon and lighting are new.
  if exists (
      select 1 from pg_temp.matrix_707_items_before b
        left join public.matrix_items i on i.code = b.code
       where i.code is null or i.label is distinct from b.label
          or i.sort_order is distinct from b.sort_order or i.status is distinct from b.status)
    or (select count(*) from public.matrix_items) <> (select count(*) from pg_temp.matrix_707_items_before) + 2 then
    raise exception 'STOP 707: existing matrix items changed';
  end if;

  -- Rows keep model/spec/size/fire/status; every lock_version moved by exactly one.
  if exists (
      select 1 from pg_temp.matrix_707_rows_before b
        left join public.matrix_rows r on r.id = b.id
       where r.id is null
          or r.base_model_id is distinct from b.base_model_id or r.spec_code is distinct from b.spec_code
          or r.size_code is distinct from b.size_code or r.fire_selectable is distinct from b.fire_selectable
          or r.status is distinct from b.status or r.lock_version is distinct from b.lock_version + 1)
    or (select count(*) from public.matrix_rows) <> (select count(*) from pg_temp.matrix_707_rows_before) then
    raise exception 'STOP 707: matrix rows changed beyond the lock_version bump';
  end if;

  -- Every pre-existing cell keeps its value.
  if exists (
    select 1 from pg_temp.matrix_707_cells_before b
      left join public.matrix_cells c on c.matrix_row_id = b.matrix_row_id and c.matrix_item_code = b.matrix_item_code
     where c.matrix_row_id is null or c.selectable is distinct from b.selectable
  ) then
    raise exception 'STOP 707: existing matrix cells changed';
  end if;

  -- Only the aircon and lighting categories move; every other mapping is unchanged.
  if exists (
    select 1 from pg_temp.matrix_707_mapping_before b
      join public.option_categories c on c.id = b.category_id
      left join public.option_category_matrix_items x on x.category_id = b.category_id
     where x.category_id is null
        or x.matrix_item_code is distinct from
           case when c.code in ('aircon', 'lighting') then c.code else b.matrix_item_code end
  ) then
    raise exception 'STOP 707: category mappings changed beyond aircon/lighting';
  end if;

  if exists (
    select 1 from pg_temp.matrix_707_before b
     where public.customer_category_selectable(b.model_slug,b.spec_code,b.category_code)
       is distinct from b.was_selectable
  ) then
    raise exception 'STOP 707: customer-facing selectability changed during cutover';
  end if;
end;
$postflight$;
commit;
