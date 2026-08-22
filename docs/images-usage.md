# 画像の使用箇所一覧（2026-08-22 デザイン改修）

`public/images/` に追加された 13 枚の PNG（ChatGPT Image …）は、`assets/source-images/`（git 管理外）へ退避し、
JPEG（品質 88・最大幅 2400px）に最適化して以下の名前で配置しました。`next/image` の `sizes` / `fill` / `aspect-ratio` を指定し、ファーストビューのみ `priority`。

| 元ファイル | 配置先 | 内容・比率 | 使用ページ／セクション |
|---|---|---|---|
| 11_56_16 (9) | `hero/wing-sunset-coast.jpg` | 夕陽の海岸・デッキ付き Wing（16:9） | トップ：ファーストビュー（全面・priority）／OGP |
| 11_56_14 (1) | `products/wing-lakeside.jpg` | 湖畔・Wing 標準（3:2） | トップ：ストーリー「広げる」／商品一覧・トップ商品章「Wing」／シミュレーター外観（デッキなし） |
| 11_56_14 (3) | `products/wing-lakeside-deck.jpg` | 同構図・デッキ付き（3:2） | シミュレーター外観（ウッドデッキ選択時）／商品詳細ギャラリー／ウッドデッキの商品画像 |
| 11_56_15 (7) | `products/box-forest-lake.jpg` | BOX 黒×木目（3:2） | 商品一覧・トップ商品章「BOX」／BOX 詳細ヒーロー／シミュレーター BOX 外観 |
| 11_56_16 (8) | `products/flat-office-lake.jpg` | フラット・ガラス張り事務所（3:2） | 商品一覧・トップ商品章「フラット」／フラット詳細ヒーロー／シミュレーター フラット外観 |
| 11_56_14 (2) | `interior/wing-room-aircon.jpg` | 木目室内・エアコン（3:2） | トップ：ストーリー「暮らす」／Wing 詳細「特徴」／シミュレーター室内（エアコン）／エアコンの商品画像 |
| 11_56_15 (5) | `interior/wing-room-kitchen.jpg` | 木目室内＋ミニキッチン（3:2） | トップ：暮らしを組み立てる（キッチン）／シミュレーター室内（エアコン＋キッチン）／ミニキッチンの商品画像 |
| 11_56_15 (4) | `interior/room-white-aircon.jpg` | 白内装・エアコン（3:2） | トップ：暮らしを組み立てる（全幅・居室）／BOX・フラットの室内／シミュレーター BOX・フラット室内（エアコン） |
| 11_56_15 (6) | `interior/unit-bath-3point.jpg` | 3点ユニットバス（3:2） | トップ：暮らしを組み立てる（水回り）／シミュレーター水まわり（3点ユニット選択時）／3点ユニットの商品画像 |
| 11_56_16 (10) | `transport/unic-crane-lift.jpg` | ユニック吊り上げ（3:2） | トップ：設置・展開セクション（全幅）／商品詳細ギャラリー |
| 12_04_24 (2) | `brands/kirameki.jpg` | 海と朝日（4:5 縦） | トップ：ブランド「煌 KIRAMEKI」（全幅 78〜88svh、object-position 50% 62% / SP 50% 70%） |
| 12_04_24 (1) | `brands/tomoshibi.jpg` | 夜の森と灯り（4:5 縦） | トップ：ブランド「灯 TOMOSHIBI」（object-position 50% 60% / SP 50% 68%） |
| 12_04_25 (3) | `brands/midori.jpg` | 新緑の森（4:5 縦） | トップ：ブランド「翠 MIDORI」（object-position 50% 58% / SP 50% 66%） |

既存素材で継続使用：`transport/unic-loading.jpg`（ストーリー「運ぶ」）、`exterior/cove-night.jpg`（最終 CTA の背景）、`cases/*`（施工事例）、`interior/bedroom-seaview.webp`（室内・エアコンなしのプレビュー）、`interior/washroom.webp`（洗面器のプレビュー）、`floorplan/wing01-plan-full.jpg`（平面図）。

## シミュレーターの画像ルール（`preview_image_rules`）

| モデル | ビュー | 条件 | 画像 |
|---|---|---|---|
| Wing | 外観 | なし／`deck` | wing-lakeside / wing-lakeside-deck（同構図で切替） |
| Wing | 室内 | なし／`aircon`／`aircon`+`kitchen` | bedroom-seaview / wing-room-aircon / wing-room-kitchen |
| Wing | 水まわり | `ub3`（3点ユニット）／`washbasin` | unit-bath-3point / washroom |
| Wing | 平面図 | `aircon`+`shower`+`toilet`+`washbasin` | wing01-plan-full |
| BOX・フラット | 外観 | なし | box-forest-lake / flat-office-lake |
| BOX・フラット | 室内／水まわり | `aircon`／`ub3` | room-white-aircon / unit-bath-3point |

3点ユニットバスのプレビューキーを `bath` → `ub3` に変更（UB1216 と画像を区別するため）。それ以外の組み合わせは従来どおり「最も近い画像＋未反映表示」。
