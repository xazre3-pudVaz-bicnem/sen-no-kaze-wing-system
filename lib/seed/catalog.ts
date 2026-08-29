/**
 * 初期データ（単一ソース）
 * - ローカル検証モードの初期化
 * - scripts/seed-supabase.ts（Supabase へ投入）
 *
 * 構成は先方指定の商品台帳に準拠する。
 *   本体（Wing / BOX / フラット）
 *    └ 仕様（ホテル仕様 / 住宅仕様 / 事務所・店舗用）… base_models.presets
 *       └ 分類（内外装仕上げ / サッシ / 内部建具 / 設備機器 / 照明器具 / 家具 / その他 / 防火仕様 / 別途工事）… option_categories.group_*
 *          └ カテゴリー（浴室・トイレ・床材 …）… option_categories
 *             └ 商品（オプション）… options（spec_codes で仕様を絞り込み）
 *
 * 価格は「20260822見積書テンプレート.xlsx」のお客様価格（原価×1.5）から転記。
 * 本体・オプションの諸費用 15% は計算時に自動加算するため、ここには含めない。
 */
import type {
  BaseModel,
  OptionCategory,
  OptionConflict,
  OptionDependency,
  PreviewHotspot,
  PreviewImageRule,
  OptionVariantChoice,
  OptionVariantGroup,
  ProductImage,
  ProductOption,
} from '../domain/types.ts';
import { masterProducts, masterVariantChoices, masterVariantGroups } from './product-master.ts';
import { SASH_HEIGHTS, SASH_SIZES_TANTAI_HANGAIDZUKE, SASH_TYPES, SASH_WIDTHS, sashLabel } from './sash-master.ts';
import { BASE_BREAKDOWN_ITEMS, baseBreakdownLinesTotal } from './base-breakdown.ts';

const NOW = '2026-08-22T00:00:00.000Z';

export const MODEL_WING01_ID = '10000000-0000-4000-8000-000000000001';
export const MODEL_BOX_ID = '10000000-0000-4000-8000-000000000002';
export const MODEL_FLAT_ID = '10000000-0000-4000-8000-000000000003';

/** 仕様コード */
export const SPEC = { hotel: 'hotel', residence: 'residence', office: 'office' } as const;

const SITEWORK_CODES = [
  'sw-transport',
  'sw-design-permit',
  'sw-packing',
  'sw-site-install',
  'sw-electric',
  'sw-plumbing',
  'sw-foundation',
  'sw-disposal',
  'sw-site-expense',
];

// サッシは本体（分類表見積書の６．サッシ木製建具工事）に含めるため、お客様の標準構成には入れない
const COMMON_BASE = ['fire-standard', 'floor-light-beige', 'wall-ceiling-cross', 'exterior-galnote', 'door-standard'];

export const seedModels: BaseModel[] = [
  {
    id: MODEL_WING01_ID,
    slug: 'wing-01',
    name: 'Wing',
    tagline: '4tユニック1台で運び、30分で広がる折り畳み式木造コンテナ。',
    description:
      '折り畳み式木造コンテナ「Wing」の基本モデル。工場で内外装まで仕上げた状態で折り畳んで運搬し、現地で下ろして展開するだけで荷台の約2倍・18.72㎡（約11.5帖）の空間が完成します。伸縮する柱脚が不陸や傾斜地を吸収するため造成を最小限にでき、建築確認申請の取得にも対応。別荘・宿泊施設・事務所・店舗・住まいまで、多用途に使える「小さな宝箱」です。',
    // 本体一式 ＝ 分類表見積書（20260827）ホテルUB シートの明細合計（売価）
    base_price: baseBreakdownLinesTotal('wing-01', 'hotel') ?? 2156364,
    expense_rate: 0.15,
    presets: [
      {
        code: 'hotel',
        name: 'ホテル仕様',
        description: '浴槽付きユニットバス・独立トイレ・洗面・折り畳みベッド。客室として使う構成です。',
        option_codes: [
          ...COMMON_BASE,
          'interior-hotel-wing',
          'carpentry-full-wing',
          'ub-1216',
          'toilet-washlet',
          'washbasin-kb',
          'faucet-kb',
          'gas-boiler-16',
          'aircon',
          'smart-key',
          'shoe-box',
          'folding-bed',
          'lighting-downlight',
          ...SITEWORK_CODES,
        ],
      },
      {
        code: 'residence',
        name: '住宅仕様',
        description: '3点ユニットバス・ミニキッチン・エアコン付き。お一人様の住まい向けの構成です。',
        option_codes: [
          ...COMMON_BASE,
          'interior-standard-wing',
          'carpentry-full-wing',
          'ub-3point-1216',
          'toilet-washlet',
          'mini-kitchen',
          'gas-boiler-16',
          'aircon',
          'smart-key',
          'shoe-box',
          'coat-rack',
          'lighting-downlight',
          ...SITEWORK_CODES,
        ],
      },
      {
        code: 'office',
        name: '事務所・店舗用',
        description: '水まわり設備なしの一室空間。事務所・店舗向けの構成です。',
        option_codes: [...COMMON_BASE, 'interior-standard-wing', 'carpentry-office-wing', 'lighting-downlight', 'office-supplies', ...SITEWORK_CODES],
      },
    ],
    status: 'published',
    sort_order: 1,
    specs: [
      { label: '折り畳み時外形', value: '約 幅2,150 × 長さ4,950 × 高さ2,600 mm（4tトラック平ボディに積載）' },
      { label: '展開後', value: '3,900 × 4,800 mm（18.72㎡・約11.5帖）' },
      { label: '最高高さ', value: '2,595.8 mm' },
      { label: '構造', value: '木造 2×4（工場生産・折り畳み機構）' },
      { label: '断熱', value: 'グラスウール 90mm（標準）／スタイロフォーム 90mm（高断熱仕様）' },
      { label: '屋根', value: 'ガルバリウム鋼板' },
      { label: '外壁', value: '角スパンガルバリウム鋼板＋木板下見板張り（防腐剤塗り）' },
      { label: '基礎', value: 'ジャッキベース付き伸縮式柱脚（不陸・傾斜地対応）※設置後に基礎施工' },
      { label: '建具', value: '玄関ドア・引違／押出／縦辷り窓・木製建具（クローゼット）' },
      { label: '運搬', value: '4tユニック車 1台' },
      { label: '展開時間', value: '約30分' },
      { label: '法規', value: '建築確認申請の取得に対応（条件により異なります）' },
    ],
    features: [
      { title: '運べる家', body: '内外装を仕上げた状態で折り畳み、4tユニック1台で運搬。朝に現場へ届き、夜には暮らし始められます。' },
      { title: '30分で2倍の広さ', body: '屋根を上げ、両脇の壁を広げ、床を下ろして正面の壁を建てる。約30分で荷台の約2倍の空間に。' },
      { title: '傾斜地にそのまま', body: '伸縮する柱脚が土地の不陸を吸収。造成を最小限に抑え、自然のままの景色に置けます。' },
      { title: '高級ホテルの内装', body: '木造ならではの温かみを活かした、高級ホテルをイメージした仕上げ。住まいにも宿泊施設にも。' },
      { title: '確認申請が取れる品質', body: '建築確認申請の取得に対応。高性能住宅レベルの品質で、住宅ローンやリースの検討も可能です。' },
      { title: '不要になったら移動・下取り', body: '撤去して移動、2台結合で家族の広さに。災害時の仮設住宅としても活用できます。' },
    ],
    standard_equipment: [
      '折り畳み式木造躯体（屋根・壁・床）・金物一式',
      'ジャッキベース付き伸縮式柱脚',
      '断熱材 グラスウール 90mm（床・壁・天井）',
      '屋根・外壁 ガルバリウム鋼板、下見板張り',
      '床下用ガルバリウム鋼板',
      '玄関ドア（サッシ）',
      '引違・押出・縦辷り窓 一式',
      '木製建具（クローゼット）',
      '本体組立・外壁張り・合板施工',
    ],
    use_cases: ['別荘・セカンドハウス', '宿泊施設・グランピング', '事務所・サテライトオフィス', '店舗・カフェ', 'お一人様の住まい', '災害時の仮設住宅'],
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: MODEL_BOX_ID,
    slug: 'box',
    name: 'BOX',
    tagline: 'コンパクトな箱型ユニット。ホテル・単身者向けの1室に。',
    description:
      '折り畳み機構を持たない箱型の木造ユニット。Wing と同じ工場生産・同じ外装仕様で、宿泊施設の客室や単身者向けの住まいに向いたコンパクトサイズです。シャワーユニットを組み込んだホテル仕様を基本プランとしています。',
    base_price: baseBreakdownLinesTotal('box', 'hotel') ?? 1600610,
    expense_rate: 0.15,
    presets: [
      {
        code: 'hotel',
        name: 'ホテル仕様',
        description: 'シャワーユニット 1116 を組み込んだ客室仕様。',
        option_codes: [...COMMON_BASE, 'interior-standard-box', 'carpentry-box', 'shower-unit-1116', 'gas-boiler-16', 'aircon', 'smart-key', 'lighting-downlight', ...SITEWORK_CODES],
      },
      {
        code: 'residence',
        name: '住宅仕様',
        description: 'シャワートイレユニットとミニキッチンを備えた単身者向け構成。',
        option_codes: [...COMMON_BASE, 'interior-standard-box', 'carpentry-box', 'shower-toilet-unit-1116', 'mini-kitchen', 'gas-boiler-16', 'aircon', 'smart-key', 'coat-rack', 'lighting-downlight', ...SITEWORK_CODES],
      },
      {
        code: 'office',
        name: '事務所・店舗用',
        description: '水まわり設備なしの一室空間。',
        option_codes: [...COMMON_BASE, 'interior-standard-box', 'carpentry-box', 'lighting-downlight', 'office-supplies', ...SITEWORK_CODES],
      },
    ],
    status: 'published',
    sort_order: 2,
    specs: [
      { label: '床面積', value: '約10.56㎡（約6.4帖）※寸法は確認中' },
      { label: '構造', value: '木造 2×4（工場生産・箱型）' },
      { label: '断熱', value: 'グラスウール 90mm' },
      { label: '屋根・外壁', value: 'ガルバリウム鋼板＋下見板張り' },
      { label: '建具', value: '玄関ドア' },
      { label: '運搬', value: '4tユニック車（要確認）' },
    ],
    features: [
      { title: '客室に最適なサイズ', body: 'シャワーユニットを組み込んだホテル・単身者向けの1室ユニット。' },
      { title: 'Wing と同じ仕上げ', body: '外装・断熱・建具は Wing と共通仕様。複数棟を並べても統一感があります。' },
      { title: '工場生産で短工期', body: '工場で仕上げて運搬・設置。現地の工期を最小限に。' },
    ],
    standard_equipment: ['木造躯体・金物一式', 'ジャッキベース付き柱脚', '断熱材 グラスウール 90mm', '屋根・外壁 ガルバリウム鋼板', '玄関ドア'],
    use_cases: ['宿泊施設の客室', '単身者の住まい', '離れ・ゲストルーム'],
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: MODEL_FLAT_ID,
    slug: 'flat',
    name: 'フラット',
    tagline: '事務所・店舗向けのフラットタイプ。',
    description:
      '事務所・店舗用途を想定したフラットタイプの木造ユニット。水まわり設備を持たない素直な一室空間を基本構成とし、必要に応じてトイレやミニキッチンを追加できます。',
    base_price: baseBreakdownLinesTotal('flat', 'office') ?? 1480705,
    expense_rate: 0.15,
    presets: [
      {
        code: 'office',
        name: '事務所・店舗用',
        description: '内装仕上げと造作のみの事務所向け構成。',
        option_codes: [...COMMON_BASE, 'interior-standard-flat', 'carpentry-flat', 'lighting-downlight', 'office-supplies', ...SITEWORK_CODES],
      },
    ],
    status: 'published',
    sort_order: 3,
    specs: [
      { label: '床面積', value: '約16.24㎡（約9.8帖）※寸法は確認中' },
      { label: '構造', value: '木造 2×4（工場生産）' },
      { label: '断熱', value: 'グラスウール 90mm' },
      { label: '屋根・外壁', value: 'ガルバリウム鋼板＋下見板張り' },
      { label: '建具', value: '玄関ドア' },
    ],
    features: [
      { title: '使いやすい一室空間', body: '事務所・店舗・作業場に向く、間仕切りのないフラットな空間。' },
      { title: '必要な設備だけ追加', body: 'トイレ・ミニキッチン・エアコンはオプションで選択。' },
      { title: '工場生産で短工期', body: '工場で仕上げて運搬・設置。現地の工期を最小限に。' },
    ],
    standard_equipment: ['木造躯体・金物一式', 'ジャッキベース付き柱脚', '断熱材 グラスウール 90mm', '屋根・外壁 ガルバリウム鋼板', '玄関ドア'],
    use_cases: ['事務所・サテライトオフィス', '店舗・カフェ', '作業場・アトリエ'],
    created_at: NOW,
    updated_at: NOW,
  },
];

export const seedProductImages: ProductImage[] = [
  // ---- Wing ----
  { id: '11000000-0000-4000-8000-000000000001', base_model_id: MODEL_WING01_ID, kind: 'hero', url: '/images/hero/wing-sunset-coast.jpg', alt: '夕陽に染まる海岸の高台に建つデッキ付きのWing', caption: '完成イメージ（CGパース）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000002', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/products/wing-lakeside.jpg', alt: '湖を望む高台に建つWing（標準・デッキなし）', caption: '外観イメージ（標準）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000003', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/products/wing-lakeside-deck.jpg', alt: '湖を望む高台に建つウッドデッキ付きのWing', caption: 'ウッドデッキ（オプション）付き外観イメージ', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000017', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/products/wing-deck-family.jpg', alt: '湖畔のデッキで家族が過ごすWing（複数棟）', caption: '外観パース（デッキ・複数棟）', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000004', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/exterior/cove-day.jpg', alt: '入り江のほとりに設置されたWing（昼）', caption: '外観イメージ（昼）', sort_order: 4 },
  { id: '11000000-0000-4000-8000-000000000005', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/exterior/cove-night.jpg', alt: '入り江のほとりに設置されたWing（夜）', caption: '外観イメージ（夜）', sort_order: 5 },
  { id: '11000000-0000-4000-8000-000000000006', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/wing-room-aircon.jpg', alt: '木目の壁に囲まれたベッドとデスクのある室内（エアコン付き）', caption: '室内イメージ（居室・エアコン）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000007', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/wing-room-kitchen.jpg', alt: 'ミニキッチンを備えた木目の室内', caption: '室内イメージ（ミニキッチン）', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000008', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/unit-bath-3point.jpg', alt: '浴槽・トイレ・洗面器が一体の3点ユニットバス', caption: '3点ユニットバス', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000016', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/living-tv.jpg', alt: '壁掛けテレビとカウンターのある室内', caption: '室内イメージ（カウンター・壁掛けTV）', sort_order: 4 },
  { id: '11000000-0000-4000-8000-000000000009', base_model_id: MODEL_WING01_ID, kind: 'floorplan', url: '/images/plan/wing-hotel.png', alt: 'Wing ホテル仕様の平面図（UB・洗面トイレ・客室7.4帖）', caption: '平面図（ホテル仕様）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000018', base_model_id: MODEL_WING01_ID, kind: 'floorplan', url: '/images/plan/wing-residence.png', alt: 'Wing 住宅仕様の平面図（LD7帖・キッチン・SW/WC）', caption: '平面図（住宅仕様）', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000010', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-crane-lift.jpg', alt: '4tユニック車のクレーンで吊り上げられる折り畳み状態のWing', caption: '4tユニックで搬入・設置', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000011', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-loading.jpg', alt: '4tユニック車に積み込まれた折り畳み状態のWing', caption: '折り畳んで積載', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000012', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-placed-wide.jpg', alt: '高台に据え置かれた折り畳み状態のWing', caption: '据え置き後、約30分で展開', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000013', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/cases/iwate-yamada-funakoshi.png', alt: '岩手県山田町・船越大島の海辺に並ぶWing', caption: '岩手県山田町 船越大島', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000014', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/exterior/anamizu-cove.jpg', alt: '石川県穴水町の入り江に置かれたWing', caption: '石川県穴水町 入り江', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000015', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/cases/island-resort.png', alt: '島のデッキに3棟並んだWing', caption: '離島リゾート計画（イメージ）', sort_order: 3 },
  // ---- 20260818 コンテナ説明用パンフレットより（先方提供 CG） ----
  { id: '11000000-0000-4000-8000-000000000041', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/products/wing-rockshore-triple.jpg', alt: '雪山を望む海岸の岩場に3棟並ぶWing', caption: '海辺のリゾート（CGパース）', sort_order: 6 },
  { id: '11000000-0000-4000-8000-000000000042', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/exterior/wing-night-fireworks.jpg', alt: '花火の上がる夜の湖畔に灯るWing', caption: '湖畔の夜（CGパース）', sort_order: 4 },
  { id: '11000000-0000-4000-8000-000000000043', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/washroom-seaview.jpg', alt: '海を望む洗面室（木の内装と白い洗面ボウル）', caption: '洗面室イメージ（CGパース）', sort_order: 5 },
  { id: '11000000-0000-4000-8000-000000000044', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/bedroom-garden.jpg', alt: '庭の緑が見えるベッドルーム（エアコン・アクセントパネル）', caption: 'ベッドルームイメージ（CGパース）', sort_order: 6 },
  { id: '11000000-0000-4000-8000-000000000045', base_model_id: MODEL_WING01_ID, kind: 'floorplan', url: '/images/plan/wing-isometric.jpg', alt: 'Wing の 3D アイソメ間取りパース（デッキ・ベッド・水まわり）', caption: '間取り 3D パース', sort_order: 3 },
  // ---- BOX ----
  { id: '11000000-0000-4000-8000-000000000021', base_model_id: MODEL_BOX_ID, kind: 'hero', url: '/images/products/box-forest-lake.jpg', alt: '湖畔の木立に建つ黒い外装と木目の BOX', caption: '完成イメージ（CGパース）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000022', base_model_id: MODEL_BOX_ID, kind: 'exterior', url: '/images/products/box-forest-lake.jpg', alt: '湖畔の木立に建つ BOX の外観', caption: '外観イメージ', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000023', base_model_id: MODEL_BOX_ID, kind: 'interior', url: '/images/interior/room-white-aircon.jpg', alt: '白い壁とベッド・デスクのある室内（エアコン付き）', caption: '室内イメージ（エアコン）', sort_order: 1 },
  // ---- フラット ----
  { id: '11000000-0000-4000-8000-000000000031', base_model_id: MODEL_FLAT_ID, kind: 'hero', url: '/images/products/flat-office-lake.jpg', alt: '湖を背にした全面ガラスのフラットタイプ事務所', caption: '完成イメージ（CGパース）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000032', base_model_id: MODEL_FLAT_ID, kind: 'exterior', url: '/images/products/flat-office-lake.jpg', alt: 'フラットタイプの外観', caption: '外観イメージ', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000033', base_model_id: MODEL_FLAT_ID, kind: 'interior', url: '/images/interior/room-white-aircon.jpg', alt: '白い壁の室内（エアコン付き）', caption: '室内イメージ（エアコン）', sort_order: 1 },
];

/* ---------------- カテゴリー（分類フォルダ › カテゴリー） ---------------- */

const cid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const C = {
  floor: cid(1),
  wallCeiling: cid(2),
  exteriorWall: cid(3),
  sash: cid(4),
  interiorDoor: cid(5),
  ub: cid(6),
  toilet: cid(7),
  washbasin: cid(8),
  kitchen: cid(9),
  boiler: cid(10),
  aircon: cid(11),
  lighting: cid(12),
  furniture: cid(13),
  appliances: cid(14),
  smartlock: cid(15),
  carpentry: cid(16),
  exteriorParts: cid(17),
  fireproof: cid(18),
  officeSupplies: cid(19),
  sitework: cid(20),
  insulation: cid(21),
  freeProduct: cid(22),
};

const cat = (
  id: string,
  code: string,
  name: string,
  group: [string, string, number],
  sort: number,
  opts: Partial<OptionCategory> = {}
): OptionCategory => ({
  id,
  code,
  name,
  group_code: group[0],
  group_name: group[1],
  group_sort: group[2],
  description: null,
  selection_mode: 'single',
  finish_level: 'full',
  is_required: false,
  customer_visible: true,
  sort_order: sort,
  status: 'published',
  ...opts,
});

// 並び順は先方の本体分類表（防火・非防火 → 屋根・外壁 → 内装 → 玄関ドア → サッシ → 設備 → …）に合わせる
const G = {
  fireproof: ['fireproof', '防火仕様', 1] as [string, string, number],
  finish: ['finish', '内外装仕上げ', 2] as [string, string, number],
  door: ['interior-door', '内部建具', 3] as [string, string, number],
  sash: ['sash', 'サッシ', 4] as [string, string, number],
  equipment: ['equipment', '設備機器', 5] as [string, string, number],
  lighting: ['lighting', '照明器具', 6] as [string, string, number],
  furniture: ['furniture', '家具', 7] as [string, string, number],
  other: ['other', 'その他', 8] as [string, string, number],
  sitework: ['sitework', '別途工事', 9] as [string, string, number],
  free: ['free-product', 'フリー商品', 10] as [string, string, number],
};

export const seedCategories: OptionCategory[] = [
  cat(C.exteriorWall, 'exterior-wall', '外壁', G.finish, 1, { finish_level: 'shell', is_required: true, description: '外壁の仕上げ材（屋根はガルバリウム鋼板で本体に含まれます）' }),
  cat(C.floor, 'floor', '床材', G.finish, 2, { is_required: true, description: '床の仕上げ材（カラーを選択）' }),
  cat(C.wallCeiling, 'wall-ceiling', '壁・天井', G.finish, 3, { is_required: true, description: '壁・天井の仕上げ' }),
  // サッシはエンドユーザーに選ばせない（本体の内訳に含める）。台帳・代理店の見積編集では使う
  cat(C.sash, 'sash', 'サッシ', G.sash, 1, { finish_level: 'shell', customer_visible: false, description: '本体に含まれるため、お客様の画面には表示しません' }),
  cat(C.interiorDoor, 'interior-door', '内部建具', G.door, 1, { is_required: true }),
  cat(C.ub, 'ub', '浴室（ユニットバス）', G.equipment, 1, { finish_level: 'equipment', description: '浴室ユニット。いずれか1つ' }),
  cat(C.kitchen, 'kitchen', 'キッチン', G.equipment, 2, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.washbasin, 'washbasin', '洗面', G.equipment, 3, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.toilet, 'toilet', 'トイレ', G.equipment, 4, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.boiler, 'boiler', '給湯', G.equipment, 5, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.aircon, 'aircon', '空調', G.equipment, 6, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.lighting, 'lighting', '照明器具', G.lighting, 1, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.furniture, 'furniture', '家具', G.furniture, 1, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.appliances, 'appliances', '家電', G.furniture, 2, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.smartlock, 'smartlock', 'スマートロック・鍵', G.other, 1, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.carpentry, 'carpentry', '造作工事', G.other, 2, { is_required: true }),
  cat(C.exteriorParts, 'exterior-parts', '外構部品', G.other, 3, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.officeSupplies, 'office-supplies', '事務所用品', G.other, 4, { finish_level: 'equipment', selection_mode: 'multi' }),
  cat(C.fireproof, 'fireproof', '防火仕様', G.fireproof, 1, { finish_level: 'shell', is_required: true, description: '建築する場所によって異なります。詳しくは近くの代理店にご相談ください' }),
  cat(C.insulation, 'insulation', '断熱仕様', G.finish, 4, { finish_level: 'shell', selection_mode: 'multi', description: '本体の断熱性能。あとから変更できないため本体注文時に選びます' }),
  // 防火仕様カテゴリーは注文範囲の選択に隣接して表示する（並び順は G.fireproof=1）
  cat(C.freeProduct, 'free-product', 'フリー商品', G.free, 1, {
    finish_level: 'equipment',
    selection_mode: 'multi',
    description: '代理店・工務店が登録した商品（家具など）。諸費用はかからず、見積書では別途工事の下に表示されます',
  }),
  cat(C.sitework, 'sitework', '別途工事（現地施工）', G.sitework, 1, {
    finish_level: 'shell',
    selection_mode: 'multi',
    description: '設置場所の確認後、代理店がお見積りします',
  }),
];

/* ---------------- 商品（オプション） ---------------- */

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const O = {
  ub1216: id(1),
  ub3point: id(2),
  showerUnit: id(3),
  showerToiletUnit: id(4),
  toiletWashlet: id(5),
  washbasinKb: id(6),
  faucetKb: id(7),
  miniKitchen: id(8),
  gasBoiler: id(9),
  aircon: id(10),
  smartKey: id(11),
  shoeBox: id(12),
  hangerPipe: id(13),
  coatRack: id(14),
  foldingBed: id(15),
  lightingExtra: id(16),
  woodDeck: id(17),
  sunroof: id(18),
  table: id(19),
  fridge: id(20),
  washer: id(21),
  interiorStdWing: id(30),
  interiorHotelWing: id(31),
  carpentryFullWing: id(32),
  carpentryOfficeWing: id(33),
  insulationUpgradeWing: id(34),
  interiorStdBox: id(40),
  carpentryBox: id(41),
  interiorStdFlat: id(50),
  carpentryFlat: id(51),
  swTransport: id(60),
  swDesignPermit: id(61),
  swPacking: id(62),
  swSiteInstall: id(63),
  swElectric: id(64),
  swPlumbing: id(65),
  swFoundation: id(66),
  swDisposal: id(67),
  swSiteExpense: id(68),
  // 追加（先方の商品台帳）
  floorWhite: id(70),
  floorLightBeige: id(71),
  floorBeige: id(72),
  floorAmidaBeige: id(73),
  floorGray: id(74),
  floorBlack: id(75),
  floorBrown: id(76),
  floorMixBrown: id(77),
  wallCross: id(80),
  wallRawan: id(81),
  exteriorGalnote: id(85),
  exteriorWood: id(86),
  sashStandard: id(90),
  sashResin: id(91),
  doorStandard: id(95),
  doorGlass: id(96),
  lightingDownlight: id(100),
  lightingPendant: id(101),
  fireStandard: id(105),
  fireProof: id(106),
  officeSupplies: id(110),
};

const opt = (
  p: Partial<ProductOption> & Pick<ProductOption, 'id' | 'category_id' | 'code' | 'name' | 'price' | 'sort_order'>
): ProductOption => ({
  base_model_id: null,
  description: null,
  image_url: null,
  selection_type: 'checkbox',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: false,
  preview_key: null,
  affects_views: [],
  spec_codes: [],
  owner_id: null,
  manufacturer: null,
  model_no: null,
  size_note: null,
  list_price: null,
  highlight: null,
  status: 'published',
  created_at: NOW,
  updated_at: NOW,
  ...p,
});

const sitework = (oid: string, code: string, name: string, description: string | null, sort: number) =>
  opt({
    id: oid,
    category_id: C.sitework,
    code,
    name,
    description,
    price: 0,
    is_installation: true,
    price_on_request: true,
    is_default: true,
    is_required: true,
    sort_order: sort,
  });

const floor = (oid: string, code: string, name: string, sort: number, isDefault = false) =>
  opt({
    id: oid,
    category_id: C.floor,
    code,
    name,
    description: 'モクタイル（クリア塗装品）のカラーバリエーション',
    price: 0,
    selection_type: 'radio',
    is_default: isDefault,
    image_url: '/images/equipment/floor-colors.png',
    sort_order: sort,
  });

export const seedOptions: ProductOption[] = [
  // ---- 内外装仕上げ：床材（8色） ----
  floor(O.floorWhite, 'floor-white', '床材 WHITE（ホワイト）', 1),
  floor(O.floorLightBeige, 'floor-light-beige', '床材 LIGHT BEIGE（ライトベージュ）', 2, true),
  floor(O.floorBeige, 'floor-beige', '床材 BEIGE（ベージュ）', 3),
  floor(O.floorAmidaBeige, 'floor-amida-beige', '床材 AMIDA BEIGE（アミダベージュ）', 4),
  floor(O.floorGray, 'floor-gray', '床材 GRAY（グレー）', 5),
  floor(O.floorBlack, 'floor-black', '床材 BLACK（ブラック）', 6),
  floor(O.floorBrown, 'floor-brown', '床材 BROWN（ブラウン）', 7),
  floor(O.floorMixBrown, 'floor-mix-brown', '床材 MIX BROWN（ミックスブラウン）', 8),

  // ---- 内外装仕上げ：壁・天井 ----
  opt({ id: O.wallCross, category_id: C.wallCeiling, code: 'wall-ceiling-cross', name: '壁・天井 クロス仕上げ', description: '標準のクロス仕上げ。', price: 0, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.wallRawan, category_id: C.wallCeiling, code: 'wall-ceiling-rawan', name: '壁・天井 ラワン板張り（ホテル仕様）', description: 'モクボードラワン 5mm＋ラワンべニア。ホテルライクな質感。', price: 97448, selection_type: 'radio', sort_order: 2 }),

  // ---- 内外装仕上げ：外壁 ----
  opt({ id: O.exteriorGalnote, category_id: C.exteriorWall, code: 'exterior-galnote', name: '外壁 SP-ガルノート（角スパンガルバリウム鋼板）', description: '標準の外壁材。メンテナンス性に優れます。', price: 0, selection_type: 'radio', is_default: true, image_url: '/images/equipment/wall-galnote.png', preview_key: 'exterior_galva', affects_views: ['exterior'], sort_order: 1 }),
  opt({ id: O.exteriorWood, category_id: C.exteriorWall, code: 'exterior-wood', name: '外壁 木板下見板張り（防腐剤塗り）', description: '木の表情を活かした横張りの下見板仕上げ。', price: 120000, selection_type: 'radio', sort_order: 2 }),

  // ---- サッシ ----
  opt({ id: O.sashStandard, category_id: C.sash, code: 'sash-standard', name: 'サッシ 標準（引違・押出・縦辷り窓一式）', description: '玄関ドア・引違い窓・押出窓・縦辷り窓の一式。', price: 0, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.sashResin, category_id: C.sash, code: 'sash-resin', name: 'サッシ 樹脂サッシ（寒冷地仕様）', description: '寒冷地・積雪地向けに断熱性を高めた樹脂サッシ。', price: 235278, selection_type: 'radio', sort_order: 2 }),

  // ---- 内部建具 ----
  opt({ id: O.doorStandard, category_id: C.interiorDoor, code: 'door-standard', name: '内部建具 標準（木製建具）', description: '木目の室内ドア・クローゼット建具。', price: 0, selection_type: 'radio', is_default: true, image_url: '/images/equipment/interior-door.png', sort_order: 1 }),
  opt({ id: O.doorGlass, category_id: C.interiorDoor, code: 'door-glass', name: '玄関ドアをガラス框ドアへ変更', description: '採光の取れるガラス框ドアへ変更。', price: 160000, selection_type: 'radio', sort_order: 2 }),

  // ---- 設備機器：浴室 ----
  opt({ id: O.ub1216, category_id: C.ub, code: 'ub-1216', name: 'ユニットバス 1216（浴槽付）', description: '浴槽付きのユニットバス 1216 サイズ。トイレ・洗面は別途選択。', price: 570000, selection_type: 'radio', image_url: '/images/equipment/unit-bath.png', preview_key: 'bath', affects_views: ['floorplan', 'water'], spec_codes: ['hotel', 'residence'], sort_order: 1 }),
  opt({ id: O.ub3point, category_id: C.ub, code: 'ub-3point-1216', name: '3点ユニットバス 1216（浴槽・トイレ・洗面一体）', description: '浴槽・トイレ・洗面器が一体になった 3点ユニット。洗面器の追加は不要です。', price: 510000, selection_type: 'radio', image_url: '/images/interior/unit-bath-3point.jpg', preview_key: 'ub3', affects_views: ['floorplan', 'water'], spec_codes: ['hotel', 'residence'], sort_order: 2 }),
  opt({ id: O.showerUnit, category_id: C.ub, code: 'shower-unit-1116', name: 'シャワーユニット 1116', description: '浴槽なしのシャワーユニット。BOX のホテル仕様で採用。', price: 810000, selection_type: 'radio', preview_key: 'shower', affects_views: ['floorplan', 'water'], spec_codes: ['hotel', 'residence'], sort_order: 3 }),
  opt({ id: O.showerToiletUnit, category_id: C.ub, code: 'shower-toilet-unit-1116', name: 'シャワートイレユニット 1116', description: 'シャワーとトイレが一体になったコンパクトユニット。', price: 510000, selection_type: 'radio', preview_key: 'shower', affects_views: ['floorplan', 'water'], spec_codes: ['hotel', 'residence'], sort_order: 4 }),

  // ---- 設備機器：トイレ・洗面・キッチン・給湯・空調 ----
  opt({ id: O.toiletWashlet, category_id: C.toilet, code: 'toilet-washlet', name: 'トイレ（温水洗浄便座ウォッシュレット）', description: '温水洗浄便座付きトイレ。', price: 225000, image_url: '/images/equipment/toilet.png', preview_key: 'toilet', affects_views: ['floorplan'], sort_order: 1 }),
  opt({ id: O.washbasinKb, category_id: C.washbasin, code: 'washbasin-kb', name: '洗面器 KB-PR012-03-G141', description: 'ボウル型洗面器（toolbox）。', price: 69225, preview_key: 'washbasin', affects_views: ['floorplan', 'water'], sort_order: 1 }),
  opt({ id: O.faucetKb, category_id: C.washbasin, code: 'faucet-kb', name: '混合水栓 KB-TP006-01-G141', description: '洗面器用の混合水栓（toolbox）。洗面器と合わせて選択します。', price: 90000, sort_order: 2 }),
  opt({ id: O.miniKitchen, category_id: C.kitchen, code: 'mini-kitchen', name: 'ミニキッチン', description: 'シンク・コンロ付きのコンパクトキッチン。', price: 187500, image_url: '/images/interior/wing-room-kitchen.jpg', preview_key: 'kitchen', affects_views: ['interior', 'floorplan'], spec_codes: ['residence', 'office'], sort_order: 1 }),
  opt({ id: O.gasBoiler, category_id: C.boiler, code: 'gas-boiler-16', name: 'ガス給湯器 16号', description: 'ユニットバス・シャワー・キッチンの給湯に必要です。', price: 270000, sort_order: 1 }),
  opt({ id: O.aircon, category_id: C.aircon, code: 'aircon', name: 'エアコン', description: '壁掛け式ルームエアコン 1台（室外機・リモコン付き）。', price: 375000, image_url: '/images/equipment/aircon.png', preview_key: 'aircon', affects_views: ['interior', 'floorplan'], sort_order: 1 }),

  // ---- 照明器具 ----
  opt({ id: O.lightingDownlight, category_id: C.lighting, code: 'lighting-downlight', name: '照明器具 ダウンライト一式', description: '照明器具は現地の電気設備工事（別途工事）に含めてお見積りします。', price: 0, price_on_request: true, is_default: true, sort_order: 1 }),
  opt({ id: O.lightingPendant, category_id: C.lighting, code: 'lighting-pendant', name: '照明器具 ペンダントライト追加', description: '意匠照明の追加。機種により別途お見積り。', price: 0, price_on_request: true, sort_order: 2 }),
  opt({ id: O.lightingExtra, category_id: C.lighting, code: 'lighting-extra', name: '照明器具の指定・持ち込み', description: 'ご希望の器具がある場合はご相談ください。', price: 0, price_on_request: true, sort_order: 3 }),

  // ---- 家具・家電 ----
  opt({ id: O.foldingBed, category_id: C.furniture, code: 'folding-bed', name: '折り畳み式ベッド 1200×2000', description: null, price: 120000, spec_codes: ['hotel', 'residence'], sort_order: 1 }),
  opt({ id: O.shoeBox, category_id: C.furniture, code: 'shoe-box', name: '家具下足箱', description: '玄関の下足箱（造作家具）。', price: 112500, sort_order: 2 }),
  opt({ id: O.coatRack, category_id: C.furniture, code: 'coat-rack', name: '洋服掛け 15×15', description: null, price: 64500, spec_codes: ['hotel', 'residence'], sort_order: 3 }),
  opt({ id: O.hangerPipe, category_id: C.furniture, code: 'hanger-pipe', name: 'ハンガーパイプ（取付金物共）', description: 'クローゼット用ハンガーパイプ。', price: 0, sort_order: 4 }),
  opt({ id: O.table, category_id: C.furniture, code: 'table', name: 'テーブル', description: 'サイズ・仕様により別途お見積り。', price: 0, price_on_request: true, sort_order: 5 }),
  opt({ id: O.fridge, category_id: C.appliances, code: 'fridge', name: '冷蔵庫', description: '機種により別途お見積り。', price: 0, price_on_request: true, spec_codes: ['hotel', 'residence'], sort_order: 1 }),
  opt({ id: O.washer, category_id: C.appliances, code: 'washer', name: '洗濯機', description: '機種により別途お見積り。', price: 0, price_on_request: true, spec_codes: ['residence'], sort_order: 2 }),

  // ---- その他 ----
  opt({ id: O.smartKey, category_id: C.smartlock, code: 'smart-key', name: 'スマートキー', description: '玄関ドアのスマートロック。', price: 52500, sort_order: 1 }),
  opt({ id: O.officeSupplies, category_id: C.officeSupplies, code: 'office-supplies', name: '事務所用品一式', description: 'デスク・チェア等。仕様により別途お見積り。', price: 0, price_on_request: true, is_default: true, spec_codes: ['office'], sort_order: 1 }),
  opt({ id: O.woodDeck, category_id: C.exteriorParts, code: 'wood-deck', name: 'ウッドデッキ', description: '正面に広がるウッドデッキ。※価格は仮置きです。', price: 450000, image_url: '/images/products/wing-lakeside-deck.jpg', preview_key: 'deck', affects_views: ['exterior', 'floorplan'], sort_order: 1 }),
  opt({ id: O.sunroof, category_id: C.exteriorParts, code: 'sunroof', name: 'サンルーフ', description: '設置条件により別途お見積り。', price: 0, price_on_request: true, sort_order: 2 }),

  // ---- 造作工事（モデル別・必須） ----
  opt({ id: O.carpentryFullWing, base_model_id: MODEL_WING01_ID, category_id: C.carpentry, code: 'carpentry-full-wing', name: '室内造作工事（住宅・ホテル仕様）', description: '建具取付までの室内造作 12.5人工。水まわり設備ありの構成向け。', price: 312500, selection_type: 'radio', is_default: true, spec_codes: ['hotel', 'residence'], sort_order: 1 }),
  opt({ id: O.carpentryOfficeWing, base_model_id: MODEL_WING01_ID, category_id: C.carpentry, code: 'carpentry-office-wing', name: '室内造作工事（事務所仕様）', description: '建具取付までの室内造作 7.5人工。水まわり設備なしの構成向け。', price: 187500, selection_type: 'radio', spec_codes: ['office'], sort_order: 2 }),
  opt({ id: O.carpentryBox, base_model_id: MODEL_BOX_ID, category_id: C.carpentry, code: 'carpentry-box', name: '室内造作工事', description: '建具取付までの室内造作 3.19人工。', price: 79750, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.carpentryFlat, base_model_id: MODEL_FLAT_ID, category_id: C.carpentry, code: 'carpentry-flat', name: '室内造作工事', description: '建具取付までの室内造作 7.5人工。', price: 187500, selection_type: 'radio', is_default: true, sort_order: 1 }),

  // ---- 内装セット（モデル別・必須。床/壁とは別に工事一式として計上） ----
  opt({ id: O.interiorStdWing, base_model_id: MODEL_WING01_ID, category_id: C.wallCeiling, code: 'interior-standard-wing', name: '内装工事一式（標準）', description: '床フローリング 16.24㎡、壁クロス 41.71㎡、天井クロス 16.24㎡、ラワンべニア下地。', price: 515890, selection_type: 'radio', is_default: true, sort_order: 10 }),
  opt({ id: O.interiorHotelWing, base_model_id: MODEL_WING01_ID, category_id: C.wallCeiling, code: 'interior-hotel-wing', name: '内装工事一式（ホテル仕様）', description: '床モクタイルラワン、壁モクボードラワン 5mm、天井ラワンべニア＋クロス、Pタイル。', price: 613338, selection_type: 'radio', spec_codes: ['hotel'], sort_order: 11 }),
  opt({ id: O.interiorStdBox, base_model_id: MODEL_BOX_ID, category_id: C.wallCeiling, code: 'interior-standard-box', name: '内装工事一式（標準）', description: '床フローリング 10.56㎡、壁クロス 30.8㎡、天井クロス・ラワン合板 7.38㎡。', price: 321654, selection_type: 'radio', is_default: true, sort_order: 10 }),
  opt({ id: O.interiorStdFlat, base_model_id: MODEL_FLAT_ID, category_id: C.wallCeiling, code: 'interior-standard-flat', name: '内装工事一式（標準）', description: '床フローリング 16.24㎡、壁クロス 30.8㎡、天井クロス・ラワンべニア 16.24㎡。', price: 461163, selection_type: 'radio', is_default: true, sort_order: 10 }),
  opt({ id: O.insulationUpgradeWing, base_model_id: MODEL_WING01_ID, category_id: C.insulation, code: 'insulation-upgrade-wing', name: '高断熱仕様（スタイロフォーム 90mm）', description: '床・壁・天井の断熱材をグラスウールからスタイロフォーム 90mm に変更。', price: 235278, selection_type: 'checkbox', sort_order: 5 }),

  // ---- 防火仕様（先方指定：④その他） ----
  opt({ id: O.fireStandard, category_id: C.fireproof, code: 'fire-standard', name: '非防火仕様（基本仕様）', description: '防火指定のない地域向けの標準仕様です。', price: 0, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.fireProof, category_id: C.fireproof, code: 'fire-proof', name: '防火仕様（防火構造）', description: '防火地域・準防火地域向けの防火構造。建築する場所によって異なるため、近くの代理店にご相談ください。', price: 0, price_on_request: true, selection_type: 'radio', sort_order: 2 }),

  // ---- 別途工事 ----
  sitework(O.swTransport, 'sw-transport', '運送費', '設置場所までの運搬', 1),
  sitework(O.swDesignPermit, 'sw-design-permit', '設計監理及び確認申請費', '建築確認申請が必要な場合', 2),
  sitework(O.swPacking, 'sw-packing', '梱包養生', null, 3),
  sitework(O.swSiteInstall, 'sw-site-install', '現場設置工事', 'クレーン設置・展開作業', 4),
  sitework(O.swElectric, 'sw-electric', '電気設備工事', '照明器具含む', 5),
  sitework(O.swPlumbing, 'sw-plumbing', '給排水給湯設備工事', '敷地状況によって別途見積', 6),
  sitework(O.swFoundation, 'sw-foundation', '基礎工事（設置後工事）', null, 7),
  sitework(O.swDisposal, 'sw-disposal', '廃材処分費', '家庭用ごみ（家具等）は別途料金。トン袋のみ', 8),
  sitework(O.swSiteExpense, 'sw-site-expense', '別途現場諸費用', '交通費、労災、安全管理費等', 9),
];

const dep = (n: number, option_id: string, requires_option_id: string, message: string | null): OptionDependency => ({
  id: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  option_id,
  requires_option_id,
  message,
});

export const seedDependencies: OptionDependency[] = [
  dep(1, O.ub1216, O.gasBoiler, 'ユニットバスにはガス給湯器が必要なため、給湯器を追加しました。'),
  dep(2, O.ub3point, O.gasBoiler, '3点ユニットバスにはガス給湯器が必要なため、給湯器を追加しました。'),
  dep(3, O.showerUnit, O.gasBoiler, 'シャワーユニットにはガス給湯器が必要なため、給湯器を追加しました。'),
  dep(4, O.showerToiletUnit, O.gasBoiler, 'シャワートイレユニットにはガス給湯器が必要なため、給湯器を追加しました。'),
  dep(5, O.miniKitchen, O.gasBoiler, 'ミニキッチンにはガス給湯器が必要なため、給湯器を追加しました。'),
  dep(6, O.faucetKb, O.washbasinKb, '混合水栓は洗面器と組み合わせて使うため、洗面器を追加しました。'),
];

export const seedConflicts: OptionConflict[] = [
  {
    id: '50000000-0000-4000-8000-000000000001',
    option_id: O.ub3point,
    conflicts_with_option_id: O.washbasinKb,
    message: '3点ユニットバスには洗面器が含まれているため、洗面器（単体）とは同時に選べません。',
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    option_id: O.showerToiletUnit,
    conflicts_with_option_id: O.toiletWashlet,
    message: 'シャワートイレユニットにはトイレが含まれているため、トイレ（単体）とは同時に選べません。',
  },
];

/* ---------------- プレビュー画像（外観・室内・水まわり・平面図・立面図） ---------------- */

const rid = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const RULE = {
  wingPlanHotel: rid(6),
  wingPlanResidence: rid(9),
};

export const seedPreviewRules: PreviewImageRule[] = [
  // Wing 外観
  { id: rid(1), base_model_id: MODEL_WING01_ID, view: 'exterior', kind: 'composite', preview_keys: ['exterior_galva'], url: '/images/products/wing-lakeside.jpg', alt: '標準外観（ガルバリウム外壁・デッキなし）', note: null, z_index: 0, status: 'published' },
  { id: rid(2), base_model_id: MODEL_WING01_ID, view: 'exterior', kind: 'composite', preview_keys: ['deck', 'exterior_galva'], url: '/images/products/wing-lakeside-deck.jpg', alt: 'ウッドデッキ付き外観（ガルバリウム外壁）', note: null, z_index: 0, status: 'published' },
  // Wing 室内
  { id: rid(3), base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: [], url: '/images/interior/bedroom-seaview.webp', alt: '標準内装の居室（エアコン・キッチンなし）', note: null, z_index: 0, status: 'published' },
  { id: rid(4), base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/wing-room-aircon.jpg', alt: 'エアコン付きの居室', note: null, z_index: 0, status: 'published' },
  { id: rid(7), base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon', 'kitchen'], url: '/images/interior/wing-room-kitchen.jpg', alt: 'エアコンとミニキッチン付きの居室', note: null, z_index: 0, status: 'published' },
  // Wing 水まわり
  { id: rid(5), base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['washbasin'], url: '/images/interior/washroom.webp', alt: '洗面器のある水まわり', note: 'ユニットバス・トイレは写っていません', z_index: 0, status: 'published' },
  { id: rid(8), base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['ub3'], url: '/images/interior/unit-bath-3point.jpg', alt: '3点ユニットバス（浴槽・トイレ・洗面器）', note: null, z_index: 0, status: 'published' },
  { id: rid(10), base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['bath'], url: '/images/equipment/unit-bath.png', alt: 'ユニットバス 1216（浴槽付）', note: null, z_index: 0, status: 'published' },
  { id: rid(11), base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['bath', 'washbasin'], url: '/images/equipment/unit-bath.png', alt: 'ユニットバス 1216（浴槽付）', note: '洗面器は別位置に設置します', z_index: 0, status: 'published' },
  { id: rid(12), base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['toilet', 'washbasin'], url: '/images/interior/washroom.webp', alt: '洗面・トイレ', note: null, z_index: 0, status: 'published' },
  // Wing 平面図（仕様別）
  { id: RULE.wingPlanHotel, base_model_id: MODEL_WING01_ID, view: 'floorplan', kind: 'composite', preview_keys: ['aircon', 'bath', 'toilet', 'washbasin'], url: '/images/plan/wing-hotel.png', alt: 'Wing ホテル仕様の平面図（UB・洗面トイレ・客室7.4帖）', note: '図面の設備をクリックすると変更できます', z_index: 0, status: 'published' },
  { id: RULE.wingPlanResidence, base_model_id: MODEL_WING01_ID, view: 'floorplan', kind: 'composite', preview_keys: ['aircon', 'kitchen', 'toilet', 'ub3'], url: '/images/plan/wing-residence.png', alt: 'Wing 住宅仕様の平面図（LD7帖・キッチン・SW/WC）', note: '図面の設備をクリックすると変更できます', z_index: 0, status: 'published' },
  { id: rid(13), base_model_id: MODEL_WING01_ID, view: 'floorplan', kind: 'composite', preview_keys: [], url: '/images/plan/wing-residence.png', alt: 'Wing 平面図（設備なし）', note: '設備を選ぶと該当の平面図に切り替わります', z_index: 0, status: 'published' },
  // BOX / フラット
  { id: rid(21), base_model_id: MODEL_BOX_ID, view: 'exterior', kind: 'composite', preview_keys: ['exterior_galva'], url: '/images/products/box-forest-lake.jpg', alt: 'BOX 標準外観（ガルバリウム外壁）', note: null, z_index: 0, status: 'published' },
  { id: rid(22), base_model_id: MODEL_BOX_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/room-white-aircon.jpg', alt: 'エアコン付きの室内', note: null, z_index: 0, status: 'published' },
  { id: rid(23), base_model_id: MODEL_BOX_ID, view: 'water', kind: 'composite', preview_keys: ['shower'], url: '/images/interior/unit-bath-3point.jpg', alt: 'シャワーユニット', note: '画像は3点ユニットバスです', z_index: 0, status: 'published' },
  { id: rid(31), base_model_id: MODEL_FLAT_ID, view: 'exterior', kind: 'composite', preview_keys: ['exterior_galva'], url: '/images/products/flat-office-lake.jpg', alt: 'フラット 標準外観（ガルバリウム外壁）', note: null, z_index: 0, status: 'published' },
  { id: rid(32), base_model_id: MODEL_FLAT_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/room-white-aircon.jpg', alt: 'エアコン付きの室内', note: null, z_index: 0, status: 'published' },
];

/**
 * 平面図のクリック領域。座標は画像に対する % で、管理画面から調整できる。
 * ホテル仕様（/images/plan/wing-hotel.png・520×525）を基準に設定。
 */
const hid = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const seedHotspots: PreviewHotspot[] = [
  // ホテル仕様の平面図：右上=UB、中央上=洗面トイレ、左上=玄関、右=壁掛けTV、上=エアコン室外機
  { id: hid(1), rule_id: RULE.wingPlanHotel, category_id: C.ub, label: 'UB（浴室）', x: 62, y: 30, w: 30, h: 22, sort_order: 1 },
  { id: hid(2), rule_id: RULE.wingPlanHotel, category_id: C.toilet, label: 'トイレ', x: 36, y: 30, w: 14, h: 22, sort_order: 2 },
  { id: hid(3), rule_id: RULE.wingPlanHotel, category_id: C.washbasin, label: '洗面', x: 50, y: 30, w: 12, h: 22, sort_order: 3 },
  { id: hid(4), rule_id: RULE.wingPlanHotel, category_id: C.aircon, label: 'エアコン', x: 74, y: 20, w: 20, h: 10, sort_order: 4 },
  { id: hid(5), rule_id: RULE.wingPlanHotel, category_id: C.furniture, label: 'ベッド・家具', x: 62, y: 62, w: 32, h: 22, sort_order: 5 },
  { id: hid(6), rule_id: RULE.wingPlanHotel, category_id: C.floor, label: '床材（居室）', x: 30, y: 60, w: 28, h: 26, sort_order: 6 },
  { id: hid(7), rule_id: RULE.wingPlanHotel, category_id: C.interiorDoor, label: '内部建具', x: 12, y: 32, w: 20, h: 22, sort_order: 7 },
  // 住宅仕様の平面図：左上=SW・WC、中央=キッチン、下=LD、左下=玄関
  { id: hid(11), rule_id: RULE.wingPlanResidence, category_id: C.ub, label: 'SW・WC（水まわり）', x: 36, y: 32, w: 30, h: 24, sort_order: 1 },
  { id: hid(12), rule_id: RULE.wingPlanResidence, category_id: C.kitchen, label: 'キッチン', x: 66, y: 34, w: 16, h: 34, sort_order: 2 },
  { id: hid(13), rule_id: RULE.wingPlanResidence, category_id: C.aircon, label: 'エアコン', x: 84, y: 36, w: 12, h: 18, sort_order: 3 },
  { id: hid(14), rule_id: RULE.wingPlanResidence, category_id: C.floor, label: '床材（LD）', x: 34, y: 62, w: 30, h: 26, sort_order: 4 },
  { id: hid(15), rule_id: RULE.wingPlanResidence, category_id: C.furniture, label: '家具', x: 4, y: 34, w: 28, h: 22, sort_order: 5 },
  { id: hid(16), rule_id: RULE.wingPlanResidence, category_id: C.interiorDoor, label: '内部建具', x: 66, y: 70, w: 16, h: 20, sort_order: 6 },
];

/** 立面図（4面）。クリックで外壁を選べる */
export const ELEVATIONS = [
  { url: '/images/elevation/wing-front.png', label: '正面（南）', alt: 'Wing 正面立面図（大開口サッシ・下見板張り）' },
  { url: '/images/elevation/wing-entrance.png', label: '玄関側（東）', alt: 'Wing 玄関側立面図（ガルバリウム縦張り・玄関ドア）' },
  { url: '/images/elevation/wing-back.png', label: '背面（北）', alt: 'Wing 背面立面図（ガルバリウム縦張り・小窓）' },
  { url: '/images/elevation/wing-side-wood.png', label: '側面（西）', alt: 'Wing 側面立面図（下見板張り）' },
];

/* ---------------- サッシの分類表 ---------------- */

/**
 * 先方共有のサッシ分類表を、種類（商品）＋サイズ（選択項目）として登録する。
 * 呼称まで読み取れたのは「単体引違 半外付」だけなので、他の種類はサイズ未登録。
 * 価格は未確定のため「別途見積」。残りは管理画面の一括登録から追加する。
 */
const sashId = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const sashOptions: ProductOption[] = SASH_TYPES.map((t, i) =>
  opt({
    id: sashId(i + 1),
    category_id: C.sash,
    code: `sash-${t.code}`,
    name: `サッシ ${t.name}`,
    description: `${t.group}。サイズは呼称から選びます。`,
    price: 0,
    price_on_request: true,
    selection_type: 'radio',
    highlight: t.group,
    sort_order: 200 + i,
  })
);

const sashSizeGroup: OptionVariantGroup = {
  id: sashId(900),
  option_id: sashId(1),
  code: 'size',
  name: 'サイズ（呼称）',
  note: '内法基準の寸法です。表にない組み合わせは選べません。',
  sort_order: 1,
  is_required: true,
  status: 'published',
};

const sashSizeChoices: OptionVariantChoice[] = Object.entries(SASH_SIZES_TANTAI_HANGAIDZUKE)
  .map(([key, code], i): OptionVariantChoice | null => {
    const [wCode, hCode] = key.split('_');
    const w = SASH_WIDTHS.find((x) => x.code === wCode);
    const h = SASH_HEIGHTS.find((x) => x.code === hCode);
    if (!w || !h) return null;
    return {
      id: sashId(1000 + i),
      group_id: sashSizeGroup.id,
      code: code.toLowerCase(),
      name: sashLabel(w, h, code),
      kind: (i === 0 ? 'standard' : 'option') as OptionVariantChoice['kind'],
      extra_price: 0,
      price_on_request: true,
      image_url: null,
      note: null,
      sort_order: i + 1,
      status: 'published' as const,
    };
  })
  .filter((v): v is OptionVariantChoice => v !== null);

/* ---------------- 先方の商品マスター（自動生成） ---------------- */

/**
 * Wing_product_master.xlsx から取り込んだ商品と、その選択項目（壁色・扉色・ミラー等）。
 * Wing 表示価格が未確定のため「別途見積」で登録している。
 * 更新は管理画面の「商品の一括登録」から。
 */
const CATEGORY_BY_CODE = new Map(seedCategories.map((c) => [c.code, c.id]));

const masterOptions: ProductOption[] = masterProducts
  .filter((p) => CATEGORY_BY_CODE.has(p.categoryCode))
  .map((p) =>
    opt({
      id: p.id,
      category_id: CATEGORY_BY_CODE.get(p.categoryCode) as string,
      code: p.code,
      name: p.name,
      description: p.description,
      price: p.price,
      price_on_request: p.price_on_request,
      image_url: p.image_url,
      manufacturer: p.manufacturer,
      model_no: p.model_no,
      size_note: p.size_note,
      list_price: p.list_price,
      highlight: p.highlight,
      selection_type: 'radio',
      sort_order: p.sort_order,
    })
  );

export const seedVariantGroups: OptionVariantGroup[] = [
  ...masterVariantGroups.map((g) => ({
    ...g,
    note: null,
    is_required: true,
    status: 'published' as const,
    // 壁色は、同じ商品の壁プランでアクセント1面／2面を選んだときだけ表示する（先方指示 2026-08-29）
    depends_on_group_code:
      g.code === 'wall-color' && masterVariantGroups.some((x) => x.option_id === g.option_id && x.code === 'wall-plan')
        ? 'wall-plan'
        : null,
    depends_on_choice_codes: g.code === 'wall-color' ? ['accent', 'accent-2'] : [],
  })),
  // 一括 upsert は全行同じ列構成で送られるため、依存フィールドを明示しておく
  { ...sashSizeGroup, depends_on_group_code: null, depends_on_choice_codes: [] },
];

export const seedVariantChoices: OptionVariantChoice[] = [
  ...masterVariantChoices.map((c) => ({ ...c, status: 'published' as const })),
  ...sashSizeChoices,
];

// 台帳へ合流させる（既存の商品より後ろに並ぶ）
seedOptions.push(...masterOptions, ...sashOptions);

/* ---------------- 本体内訳マスター（分類表見積書 20260827・売価のみ） ---------------- */

const SLUG_TO_MODEL: Record<string, string> = { 'wing-01': MODEL_WING01_ID, box: MODEL_BOX_ID, flat: MODEL_FLAT_ID };

export const seedBaseBreakdownItems = BASE_BREAKDOWN_ITEMS.map(({ model_slug, ...b }) => ({
  ...b,
  base_model_id: SLUG_TO_MODEL[model_slug],
}));

export const seedCatalog = {
  models: seedModels,
  images: seedProductImages,
  categories: seedCategories,
  options: seedOptions,
  dependencies: seedDependencies,
  conflicts: seedConflicts,
  previewRules: seedPreviewRules,
  hotspots: seedHotspots,
  variantGroups: seedVariantGroups,
  variantChoices: seedVariantChoices,
  baseBreakdownItems: seedBaseBreakdownItems,
};
