-- 商品台帳の業務状態を「下書き / 登録済み / 取扱終了」に整理し、
-- 登録済み商品のシミュレーター表示可否を商品単位で管理する。
--
-- 取扱終了は物理削除ではない。過去の Configuration / Quote / Snapshot 等からの
-- 参照を維持したまま、新規の見積・シミュレーター選択肢から外すための状態。

alter table public.options
  add column if not exists simulator_visible boolean not null default true;

comment on column public.options.simulator_visible is
  '登録済み商品をお客様向けシミュレーターの新規選択肢に表示するか。見積での選択可否とは別。';

alter table public.options
  drop constraint if exists options_status_check;

alter table public.options
  add constraint options_status_check
  check (status = any (array['published'::text, 'draft'::text, 'retired'::text]));

comment on column public.options.status is
  '商品台帳の状態。draft=下書き、published=登録済み（見積選択可）、retired=取扱終了（新規選択不可・履歴保持）。';
