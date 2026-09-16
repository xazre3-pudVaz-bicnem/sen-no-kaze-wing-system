-- シミュレーターで選択した設置予定地を Configuration に保持する。
-- 価格・仕様の自動変更は行わず、将来の寒冷地・積雪・防火・配送判定の入力情報として保存する。

alter table public.configurations
  add column if not exists site_prefecture text,
  add column if not exists site_municipality text,
  add column if not exists site_location_undecided boolean not null default false;

alter table public.configurations
  drop constraint if exists configurations_site_location_consistency;

alter table public.configurations
  add constraint configurations_site_location_consistency
  check (
    (not site_location_undecided or (site_prefecture is null and site_municipality is null))
    and (site_municipality is null or site_prefecture is not null)
  );

comment on column public.configurations.site_prefecture is 'シミュレーターで選択した設置予定地の都道府県';
comment on column public.configurations.site_municipality is 'シミュレーターで選択した設置予定地の市区町村';
comment on column public.configurations.site_location_undecided is '設置予定地は未定を明示選択した場合 true';
