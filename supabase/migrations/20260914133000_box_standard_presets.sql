-- BOX の仕様ボタンを実物Excelの標準見積体系へ統一する。
-- 旧 hotel / residence / office は BOX では使わず、
-- 「ホテル・単身者用」「水回りキット」を正本とする。
update public.base_models
set presets = jsonb_build_array(
  jsonb_build_object(
    'code', 'hotel-single',
    'name', 'ホテル・単身者用',
    'description', 'BOX（ホテル単身者）の標準見積に対応する構成です。',
    'option_codes', to_jsonb(array[
      'fire-standard',
      'floor-light-beige',
      'wall-ceiling-cross',
      'exterior-galnote',
      'door-standard',
      'interior-standard-box',
      'carpentry-box',
      'shower-unit-1116',
      'mini-kitchen',
      'folding-bed',
      'sw-transport',
      'sw-design-permit',
      'sw-packing',
      'sw-site-install',
      'sw-electric',
      'sw-plumbing',
      'sw-foundation',
      'sw-disposal',
      'sw-site-expense'
    ]::text[])
  ),
  jsonb_build_object(
    'code', 'water-kit',
    'name', '水回りキット',
    'description', 'BOX（水回りキット）の標準見積に対応する構成です。',
    'option_codes', to_jsonb(array[
      'fire-standard',
      'floor-light-beige',
      'wall-ceiling-cross',
      'exterior-galnote',
      'door-standard',
      'interior-standard-box',
      'carpentry-box',
      'ub-1216',
      'toilet-washlet',
      'mini-kitchen',
      'gas-boiler-16',
      'aircon',
      'sw-transport',
      'sw-design-permit',
      'sw-packing',
      'sw-site-install',
      'sw-electric',
      'sw-plumbing',
      'sw-foundation',
      'sw-disposal',
      'sw-site-expense'
    ]::text[])
  )
where slug = 'box';

-- preset コードを変更したため、BOXで選択可能にする商品側の適用仕様も追加する。
update public.options
set spec_codes = case code
  when 'ub-1216' then array(select distinct x from unnest(coalesce(spec_codes, '{}'::text[]) || array['water-kit']) as x)
  when 'shower-unit-1116' then array(select distinct x from unnest(coalesce(spec_codes, '{}'::text[]) || array['hotel-single']) as x)
  when 'mini-kitchen' then array(select distinct x from unnest(coalesce(spec_codes, '{}'::text[]) || array['hotel-single', 'water-kit']) as x)
  when 'folding-bed' then array(select distinct x from unnest(coalesce(spec_codes, '{}'::text[]) || array['hotel-single']) as x)
  else spec_codes
end
where code in ('ub-1216', 'shower-unit-1116', 'mini-kitchen', 'folding-bed');
