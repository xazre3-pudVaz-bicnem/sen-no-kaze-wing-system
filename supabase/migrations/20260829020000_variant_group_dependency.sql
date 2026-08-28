-- =============================================================
-- 選択項目（バリエーション）の表示条件
--
-- 先方指摘（2026-08-29 かなえさん）：
--   「壁プランで標準の全面ホワイトを選んだ場合は、下の壁色の選択が
--     消えるような仕様に変更可能でしょうか？」
--
-- 汎用の仕組みとして、選択項目に「別の選択項目でこの選択肢が選ばれて
-- いるときだけ表示する」という条件を持たせる。
--   例）壁色（wall-color）は、壁プラン（wall-plan）で
--       accent-1 / accent-2 が選ばれているときだけ表示する。
-- 条件を満たさない項目は画面に出ず、選択肢も保存されない。
-- =============================================================

alter table public.option_variant_groups
  add column if not exists depends_on_group_code text,
  add column if not exists depends_on_choice_codes text[] not null default '{}';

comment on column public.option_variant_groups.depends_on_group_code is
  '同じ商品の別の選択項目コード。指定時、その項目で depends_on_choice_codes のどれかが選ばれているときだけ表示する';
comment on column public.option_variant_groups.depends_on_choice_codes is
  '表示条件となる選択肢コードの一覧（depends_on_group_code の項目内）';
