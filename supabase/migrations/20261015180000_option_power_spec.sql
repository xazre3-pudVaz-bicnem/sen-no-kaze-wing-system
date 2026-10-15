-- 商品マスターの汎用的な電源仕様。
-- 既存商品互換のためDB列はnullableとし、空調カテゴリーの必須判定はアプリ側で行う。
alter table public.options
  add column if not exists power_spec text;

comment on column public.options.power_spec is
  'メーカー公式資料に記載された電源仕様。例: 単相100V・15A（専用回路）。空調の登録・編集時はアプリ側で必須。';
