# 不足している画像一覧（required-preview-assets）

## 1. 設備・商品画像（設備表・見積書クリック → 商品選択ポップアップに表示）

先方より「メーカー問屋で作成中」とのこと。届き次第、**管理画面 › オプション › 画像** から登録してください。
推奨：**1200×900px（4:3）・JPEG/WebP・白または無地背景**。商品が 1 つだけ写っているもの。

現状、商品 60 件のうち **44 件が画像なし**（ポップアップでは「商品画像 準備中」表示）です。

| オプション（コード） | 必要な画像 |
|---|---|
| シャワーユニット 1116（`shower-unit-1116`） | シャワーブース全景 |
| シャワートイレユニット 1116（`shower-toilet-unit-1116`） | 全景 |
| 洗面器 KB-PR012-03-G141（`washbasin-kb`） | 洗面器 |
| 混合水栓 KB-TP006-01-G141（`faucet-kb`） | 水栓 |
| ガス給湯器 16号（`gas-boiler-16`） | 給湯器 |
| スマートキー（`smart-key`） | 本体 |
| 壁・天井 クロス／ラワン板張り（`wall-ceiling-*`） | 仕上がりが分かる室内写真 |
| 外壁 木板下見板張り（`exterior-wood`） | 外壁のアップ |
| サッシ 標準／樹脂（`sash-*`） | 窓・玄関ドア |
| 玄関ドア ガラス框（`door-glass`） | ドア正面 |
| 照明器具 ダウンライト／ペンダント（`lighting-*`） | 器具単体 |
| 家具下足箱／ハンガーパイプ／洋服掛け／折り畳み式ベッド／テーブル | 各 1 枚 |
| 冷蔵庫／洗濯機／事務所用品一式 | 各 1 枚 |
| サンルーフ（`sunroof`） | 設置例 |
| 内装工事一式（標準／ホテル仕様）（`interior-*`） | 床・壁・天井の仕上がりが分かる室内写真 |
| 造作工事（`carpentry-*`）・高断熱仕様・防火／非防火仕様 | 画像なしでも可（工事項目のため） |

※ 提案書（UWⅡ）・PB（シエラ26）・建具標準品（ドレタス）のメーカー画像は転載禁止の注記があるため、そのまま使用していません。メーカーの許諾があれば同じ手順で登録できます。

## 2. 完成イメージ（選択状態に応じて切り替わる画像）

現状の登録（`lib/seed/catalog.ts` → `seedPreviewRules`）。**追加は管理画面 › プレビュー画像 から可能**です。

| モデル | ビュー | 登録済みの条件（プレビューキー） | 使用素材 |
|---|---|---|---|
| Wing | 外観 | `exterior_galva`（標準・デッキなし） | `wing-lakeside.jpg` |
| Wing | 外観 | `deck`＋`exterior_galva` | `wing-lakeside-deck.jpg` |
| Wing | 室内 | （キーなし） | `bedroom-seaview.webp` |
| Wing | 室内 | `aircon` | `wing-room-aircon.jpg` |
| Wing | 室内 | `aircon`＋`kitchen` | `wing-room-kitchen.jpg` |
| Wing | 水まわり | `bath` ／ `bath`＋`washbasin` | `equipment/unit-bath.png` |
| Wing | 水まわり | `ub3` | `unit-bath-3point.jpg` |
| Wing | 水まわり | `washbasin` ／ `toilet`＋`washbasin` | `washroom.webp` |
| Wing | 平面図 | `aircon`＋`bath`＋`toilet`＋`washbasin`（ホテル仕様の標準構成） | `plan/wing-hotel.png` |
| Wing | 平面図 | `aircon`＋`kitchen`＋`toilet`＋`ub3`（住宅仕様の標準構成） | `plan/wing-residence.png` |
| Wing | 平面図 | （キーなし） | `plan/wing-residence.png` |
| Wing | 立面図 | 常時4面（選択では切り替わらない） | `elevation/wing-{front,entrance,back,side-wood}.png` |
| BOX | 外観／室内／水まわり | `exterior_galva` ／ `aircon` ／ `shower` | `box-forest-lake.jpg` ほか |
| フラット | 外観／室内 | `exterior_galva` ／ `aircon` | `flat-office-lake.jpg` ほか |

一致しない組み合わせは「最も近い画像＋**画像に未反映：◯◯**」と表示され、管理画面 `/admin/preview-rules` に不足一覧として警告が出ます。
**存在しない完成画像を生成したり、別仕様の画像を正しい完成図として出すことはしません。**

### いま不足している組み合わせ（自動計算・2026-08-22 時点）

| モデル | 外観 | 室内 | 水まわり | 平面図 |
|---|---|---|---|---|
| Wing | 2 | 1 | 12 | 63 |
| BOX | 3 | 3 | 15 | 64 |
| フラット | 3 | 3 | 16 | 64 |

平面図の件数が大きいのは、平面図に影響する設備 6 種の全組み合わせ（2 の 6 乗）を機械的に数えているためです。
実運用では**仕様（ホテル／住宅／事務所）の標準構成に対応する平面図が揃っていれば十分**で、
標準から外れた構成は「最も近い図面」＋注記で表示されます。

### 撮影・制作の共通仕様

- 同一ビュー内で**画角・カメラ位置・時間帯・背景を完全に揃える**（設備の有無だけが変わるように）
- 推奨サイズ：**2400×1650px（16:11）**、JPEG 品質 85 または WebP。平面図・立面図は白背景 PNG
- レイヤー方式（透過 PNG）なら、ベース 1 枚＋設備ごとの透過 PNG で全組み合わせを自動合成できる

### 優先度 A：仕様ごとの平面図（Wing）— 図面クリックの土台

平面図には**クリック領域（ホットスポット）**を紐付けており、図面を差し替えると領域も設定し直しが必要です
（管理画面で 1 枚ごとに座標を % 指定。現状はホテル仕様 7 箇所・住宅仕様 6 箇所）。

| # | 画像名 | 仕様 | 使用条件（プレビューキー） |
|---|---|---|---|
| 1 | `wing_plan_office.png` | 事務所・店舗用（水まわりなし・エアコンあり） | floorplan: `aircon` |
| 2 | `wing_plan_hotel_shower.png` | ホテル仕様＋シャワーユニット | floorplan: `aircon`＋`shower`＋`toilet`＋`washbasin` |
| 3 | `wing_plan_deck.png` | 上記各仕様のウッドデッキあり版 | floorplan: 各キー＋`deck` |

### 優先度 B：水まわり（Wing）

| # | 画像名 | 仕様 | 使用条件 |
|---|---|---|---|
| 4 | `wing_water_shower.jpg` | シャワーユニット 1116 単体 | water: `shower` |
| 5 | `wing_water_shower_washbasin.jpg` | シャワーユニット＋洗面器 | water: `shower`＋`washbasin` |
| 6 | `wing_water_none.jpg` | 水まわりなし | water: （キーなし） |
| 7 | `wing_water_ub3_washbasin.jpg` | 3点ユニット＋洗面器（別置き） | water: `ub3`＋`washbasin` |

※ 現状 `bath` は設備単体写真（`equipment/unit-bath.png`）で代用しています。室内の見え方が分かる写真への差し替えを推奨します。

### 優先度 C：外観（Wing）

| # | 画像名 | 仕様 | 使用条件 |
|---|---|---|---|
| 8 | `wing_exterior_wood.jpg` | **外壁 木板下見板張り**（写真がないためガルバリウム画像の近似表示） | exterior: （キーなし） |
| 9 | `wing_exterior_wood_deck.jpg` | 同上＋ウッドデッキ | exterior: `deck` |

### 優先度 D：BOX・フラット

| # | 画像名 | 仕様 | 使用条件 |
|---|---|---|---|
| 10 | `box_interior_base.jpg` / `box_plan.png` | BOX 標準（室内・平面図） | 各ビュー |
| 11 | `box_water_shower.jpg` | シャワーユニット 1116（現状は3点ユニット写真で代用） | water: `shower` |
| 12 | `flat_interior_base.jpg` / `flat_plan.png` | フラット標準（室内・平面図） | 各ビュー |
| 13 | `{box,flat}_elevation_*.png` | 立面図4面（現状は Wing のみ） | 立面図 |

## 3. その他

- BOX・フラットの **寸法・図面**（specs が「確認中」）
- Wing 単体の正式ロゴ（現状はテキスト表示）
- 文字入りの OGP 画像（現状は `夕陽の海_建物大きめ_高画質4K.webp` からトリミング）
