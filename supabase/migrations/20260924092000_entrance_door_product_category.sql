-- 玄関ドアをサッシ・内部建具と分離し、独立した商品カテゴリーとして登録する。
-- 対象モデル・仕様によって玄関ドア不要のケースがあるため、カテゴリー自体は一律必須にはしない。
-- 既存の商品・見積・Configuration・価格・Revision・Snapshotは変更しない。

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
  '20000000-0000-4000-8000-000000000024'::uuid,
  'entrance-door',
  '玄関ドア',
  '玄関ドア。対象モデル・仕様で使用する場合に1つ選択します',
  'single',
  false,
  1,
  'published',
  'entrance-door',
  '玄関ドア',
  3,
  'shell'
)
on conflict (code) do nothing;
