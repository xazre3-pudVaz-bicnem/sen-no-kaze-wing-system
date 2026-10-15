-- 商品台帳の「登録済み」と、お客様シミュレーター表示・取扱終了を分離する。
-- 既存商品は現在の挙動を維持するため、simulator_visible=true / archived_at=null で開始する。

alter table public.options
  add column if not exists simulator_visible boolean not null default true;

alter table public.options
  add column if not exists archived_at timestamptz;

comment on column public.options.simulator_visible is
  '登録済み・取扱中の商品をお客様シミュレーターの新規選択肢へ表示するか。見積での選択可否とは別。';

comment on column public.options.archived_at is
  '取扱終了日時。NULLは取扱中。履歴保持のため商品行は削除せず、取扱再開時はNULLへ戻す。';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'options_archived_requires_published_chk'
      and conrelid = 'public.options'::regclass
  ) then
    alter table public.options
      add constraint options_archived_requires_published_chk
      check (archived_at is null or status = 'published');
  end if;
end
$$;
