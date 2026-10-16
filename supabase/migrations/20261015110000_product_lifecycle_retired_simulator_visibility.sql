-- 商品台帳の業務状態を「下書き / 登録済み / 取扱終了」に整理し、
-- 登録済み商品のシミュレーター表示可否を商品単位で管理する。
--
-- DB上の既存 status（draft / published）の意味は変えない。
-- 取扱終了は archived_at で表し、過去の Configuration / Quote / Snapshot 等からの
-- 参照を維持したまま、新規の見積・シミュレーター選択肢から外す。

alter table public.options
  add column if not exists simulator_visible boolean not null default true,
  add column if not exists archived_at timestamp with time zone;

comment on column public.options.simulator_visible is
  '登録済み商品をお客様向けシミュレーターの新規選択肢に表示するか。見積での選択可否とは別。';

comment on column public.options.archived_at is
  'NULL=現行、日時あり=取扱終了。取扱終了商品は履歴保持し、新規の見積・シミュレーター選択肢から外す。NULLへ戻すと取扱再開。';

alter table public.options
  add constraint options_archived_only_after_publish_check
  check (archived_at is null or status = 'published');
