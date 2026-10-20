-- メーカー公式商品ページの任意URL。メーカーPDF・画像・価格正本とは分離する。
-- 本番適用前に options の列・migration history・pending 順序をread-only確認すること。
-- 既存商品には NULL とし、既存の見積・Snapshot・選択肢に影響させない。
alter table public.options
  add column manufacturer_product_url text;

alter table public.options
  add constraint options_manufacturer_product_url_https_check
  check (
    manufacturer_product_url is null
    or (
      char_length(manufacturer_product_url) <= 1000
      and manufacturer_product_url ~ '^https://[^[:space:]]+$'
    )
  );

comment on column public.options.manufacturer_product_url is
  '商品登録担当者が確認したメーカー公式商品ページURL。画像/メーカーPDF URLではない。';
