-- 商品価格とメーカー参考価格の「1単位あたり」の単位を保持する。
-- 既存商品は未設定（NULL）のまま開始し、価格や履歴は書き換えない。

alter table public.options
  add column if not exists price_unit text,
  add column if not exists list_price_unit text;

comment on column public.options.price_unit is
  '商品価格 price の1単位あたりの単位。例: 台, ケース, ㎡。NULLは未設定。';

comment on column public.options.list_price_unit is
  'メーカー参考価格 list_price の1単位あたりの単位。NULLは未設定。';
