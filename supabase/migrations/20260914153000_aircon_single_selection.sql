-- エアコンは機種を1つ選択するカテゴリーとして扱う。
-- 既存DBの multi 設定を seed と同じ single に揃える。
update public.option_categories
set selection_mode = 'single'
where code = 'aircon'
  and selection_mode <> 'single';
