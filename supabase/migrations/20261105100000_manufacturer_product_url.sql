-- メーカー公式商品ページの任意URL（PR #535）。メーカーPDF・画像・価格正本とは分離する。
-- 既存商品には NULL とし、既存の見積・Snapshot・選択肢に影響させない。
-- 2026-11-05：v2.5・代理店・総代理店の拡張（20261104160000 まで）の後ろへ番号を付け替えた（旧 20261020140000。どの DB にも未適用）。
-- 本番適用前に options の列・migration history・pending 順序を read-only で確認する。
-- アプリは options を列名で読む（v2.5 PR-C1b。lib/data/legacy-price-columns.json）ので、この migration を本番へ適用してからアプリをマージする。
alter table public.options
  add column manufacturer_product_url text;

-- https・認証情報（user:pass@）なし・空白なし・1000 文字以内（アプリの optionSchema と同じ決まり。スキームの大文字小文字は問わない）
alter table public.options
  add constraint options_manufacturer_product_url_https_check
  check (
    manufacturer_product_url is null
    or (
      char_length(manufacturer_product_url) <= 1000
      and manufacturer_product_url ~* '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'
    )
  );

comment on column public.options.manufacturer_product_url is
  '商品登録担当者が確認したメーカー公式商品ページURL（https・認証情報なし）。画像/メーカーPDF URLではない。';

-- C1b：options は列ごとに読める列を決めている。アプリが読む新しい列は anon・authenticated へ列で許可する（legacy-price-columns.json と同じ）
grant select (manufacturer_product_url) on public.options to anon, authenticated;
