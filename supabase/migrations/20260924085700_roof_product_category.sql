-- 屋根を外壁と分離し、商品カテゴリーとして個別選択できるようにする。
-- 既存の商品・見積・Configuration は変更しない。
-- 屋根商品自体はこの migration では作成せず、商品マスターから登録する。

insert into public.option_categories (
  id,
  code,
  name,
  description,
  selection_mode,
  is_required,
  sort_order,
  status,
  group_code,
  group_name,
  group_sort,
  finish_level
)
values (
  '20000000-0000-4000-8000-000000000023'::uuid,
  'roof',
  '屋根',
  '屋根の仕上げ材。外壁とは別に商品を選択します',
  'single',
  true,
  0,
  'published',
  'finish',
  '内外装仕上げ',
  2,
  'shell'
)
on conflict (code) do nothing;

-- 屋根分離後は、外壁カテゴリーの説明から
-- 「屋根は本体に含まれる」という旧表現だけを除く。
update public.option_categories
set description = '外壁の仕上げ材'
where code = 'exterior-wall'
  and description = '外壁の仕上げ材（屋根はガルバリウム鋼板で本体に含まれます）';
