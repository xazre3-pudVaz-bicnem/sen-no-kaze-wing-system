/**
 * 初期データ（単一ソース）
 * - ローカル検証モードの初期化
 * - scripts/seed-supabase.ts（Supabase へ投入）
 *
 * 価格は「20260821見積書テンプレート.xlsx」のお客様価格（原価×1.5）から転記。
 * 本体・オプションの諸費用 15% は計算時に自動加算するため、ここには含めない。
 * 出典のない価格（ウッドデッキ等）は docs/assumptions.md に仮置きとして記載。
 *
 * ID は固定 UUID（再投入しても同じ ID になる）。
 */
import type {
  BaseModel,
  OptionCategory,
  OptionConflict,
  OptionDependency,
  PreviewImageRule,
  ProductImage,
  ProductOption,
} from '../domain/types.ts';

const NOW = '2026-08-22T00:00:00.000Z';

export const MODEL_WING01_ID = '10000000-0000-4000-8000-000000000001';
export const MODEL_BOX_ID = '10000000-0000-4000-8000-000000000002';
export const MODEL_FLAT_ID = '10000000-0000-4000-8000-000000000003';

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

export const seedModels: BaseModel[] = [
  {
    id: MODEL_WING01_ID,
    slug: 'wing-01',
    name: 'Wing（片ウィング）',
    tagline: '4tユニック1台で運び、30分で広がる折り畳み式木造コンテナ。',
    description:
      '折り畳み式木造コンテナ「Wing」の基本モデル。工場で内外装まで仕上げた状態で折り畳んで運搬し、現地で下ろして展開するだけで荷台の約2倍・18.72㎡（約11.5帖）の空間が完成します。伸縮する柱脚が不陸や傾斜地を吸収するため造成を最小限にでき、建築確認申請の取得にも対応。別荘・宿泊施設・事務所・店舗・住まいまで、多用途に使える「小さな宝箱」です。',
    // 見積書テンプレート「片ウィング【単身者用】」本体価格計 2,479,818 － 本体諸費用 323,454
    base_price: 2156364,
    expense_rate: 0.15,
    presets: [
      {
        code: 'single',
        name: '単身者用プラン',
        description: '3点ユニットバス・ミニキッチン・エアコン付き。お一人様の住まい・宿泊施設向けの標準構成。',
        option_codes: [
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
          ...SITEWORK_CODES,
        ],
      },
      {
        code: 'hotel-ub',
        name: 'ホテルUBプラン',
        description: '浴槽付きユニットバス・独立トイレ・洗面器・折り畳みベッド。ラワン板張りのホテル仕様内装と高断熱仕様。',
        option_codes: [
          'insulation-upgrade-wing',
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
          ...SITEWORK_CODES,
        ],
      },
      {
        code: 'office',
        name: '事務所プラン',
        description: '水まわり設備なしの事務所・店舗向け構成。内装仕上げと造作のみ。',
        option_codes: ['interior-standard-wing', 'carpentry-office-wing', ...SITEWORK_CODES],
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
    // 見積書テンプレート「BOX（ホテル単身者）」本体価格計 1,840,701 － 本体諸費用 240,091
    base_price: 1600610,
    expense_rate: 0.15,
    presets: [
      {
        code: 'hotel-single',
        name: 'ホテル・単身者プラン',
        description: 'シャワーユニット 1116 を組み込んだ客室仕様。',
        option_codes: ['interior-standard-box', 'carpentry-box', 'shower-unit-1116', 'gas-boiler-16', ...SITEWORK_CODES],
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
    // 見積書テンプレート「フラット (事務所)」本体価格計 1,702,810 － 本体諸費用 222,105
    base_price: 1480705,
    expense_rate: 0.15,
    presets: [
      {
        code: 'office',
        name: '事務所プラン',
        description: '内装仕上げと造作のみの事務所向け構成。',
        option_codes: ['interior-standard-flat', 'carpentry-flat', ...SITEWORK_CODES],
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
  { id: '11000000-0000-4000-8000-000000000004', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/exterior/cove-day.jpg', alt: '入り江のほとりに設置されたWing（昼）', caption: '外観イメージ（昼）', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000005', base_model_id: MODEL_WING01_ID, kind: 'exterior', url: '/images/exterior/cove-night.jpg', alt: '入り江のほとりに設置されたWing（夜）', caption: '外観イメージ（夜）', sort_order: 4 },
  { id: '11000000-0000-4000-8000-000000000006', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/wing-room-aircon.jpg', alt: '木目の壁に囲まれたベッドとデスクのある室内（エアコン付き）', caption: '室内イメージ（居室・エアコン）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000007', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/wing-room-kitchen.jpg', alt: 'ミニキッチンを備えた木目の室内', caption: '室内イメージ（ミニキッチン）', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000008', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/unit-bath-3point.jpg', alt: '浴槽・トイレ・洗面器が一体の3点ユニットバス', caption: '3点ユニットバス', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000016', base_model_id: MODEL_WING01_ID, kind: 'interior', url: '/images/interior/living-tv.jpg', alt: '壁掛けテレビとカウンターのある室内', caption: '室内イメージ（カウンター・壁掛けTV）', sort_order: 4 },
  { id: '11000000-0000-4000-8000-000000000009', base_model_id: MODEL_WING01_ID, kind: 'floorplan', url: '/images/floorplan/wing01-plan-full.jpg', alt: 'Wing 平面図（シャワー・トイレ・洗面・エアコン付き、デッキはオプション）', caption: '平面図（シャワー・トイレ・洗面・エアコン構成）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000010', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-crane-lift.jpg', alt: '4tユニック車のクレーンで吊り上げられる折り畳み状態のWing', caption: '4tユニックで搬入・設置', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000011', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-loading.jpg', alt: '4tユニック車に積み込まれた折り畳み状態のWing', caption: '折り畳んで積載', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000012', base_model_id: MODEL_WING01_ID, kind: 'transport', url: '/images/transport/unic-placed-wide.jpg', alt: '高台に据え置かれた折り畳み状態のWing', caption: '据え置き後、約30分で展開', sort_order: 3 },
  { id: '11000000-0000-4000-8000-000000000013', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/cases/iwate-yamada-funakoshi.png', alt: '岩手県山田町・船越大島の海辺に並ぶWing', caption: '岩手県山田町 船越大島', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000014', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/exterior/anamizu-cove.jpg', alt: '石川県穴水町の入り江に置かれたWing', caption: '石川県穴水町 入り江', sort_order: 2 },
  { id: '11000000-0000-4000-8000-000000000015', base_model_id: MODEL_WING01_ID, kind: 'case', url: '/images/cases/island-resort.png', alt: '島のデッキに3棟並んだWing', caption: '離島リゾート計画（イメージ）', sort_order: 3 },
  // ---- BOX ----
  { id: '11000000-0000-4000-8000-000000000021', base_model_id: MODEL_BOX_ID, kind: 'hero', url: '/images/products/box-forest-lake.jpg', alt: '湖畔の木立に建つ黒い外装と木目の BOX', caption: '完成イメージ（CGパース）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000022', base_model_id: MODEL_BOX_ID, kind: 'exterior', url: '/images/products/box-forest-lake.jpg', alt: '湖畔の木立に建つ BOX の外観', caption: '外観イメージ', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000023', base_model_id: MODEL_BOX_ID, kind: 'interior', url: '/images/interior/room-white-aircon.jpg', alt: '白い壁とベッド・デスクのある室内（エアコン付き）', caption: '室内イメージ（エアコン）', sort_order: 1 },
  // ---- フラット ----
  { id: '11000000-0000-4000-8000-000000000031', base_model_id: MODEL_FLAT_ID, kind: 'hero', url: '/images/products/flat-office-lake.jpg', alt: '湖を背にした全面ガラスのフラットタイプ事務所', caption: '完成イメージ（CGパース）', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000032', base_model_id: MODEL_FLAT_ID, kind: 'exterior', url: '/images/products/flat-office-lake.jpg', alt: 'フラットタイプの外観', caption: '外観イメージ', sort_order: 1 },
  { id: '11000000-0000-4000-8000-000000000033', base_model_id: MODEL_FLAT_ID, kind: 'interior', url: '/images/interior/room-white-aircon.jpg', alt: '白い壁の室内（エアコン付き）', caption: '室内イメージ（エアコン）', sort_order: 1 },
];

const C = {
  ub: '20000000-0000-4000-8000-000000000001',
  toilet: '20000000-0000-4000-8000-000000000002',
  washbasin: '20000000-0000-4000-8000-000000000003',
  kitchen: '20000000-0000-4000-8000-000000000004',
  interior: '20000000-0000-4000-8000-000000000005',
  fixtures: '20000000-0000-4000-8000-000000000006',
  lighting: '20000000-0000-4000-8000-000000000007',
  boiler: '20000000-0000-4000-8000-000000000008',
  other: '20000000-0000-4000-8000-000000000009',
  carpentry: '20000000-0000-4000-8000-000000000010',
  exteriorParts: '20000000-0000-4000-8000-000000000011',
  furniture: '20000000-0000-4000-8000-000000000012',
  appliances: '20000000-0000-4000-8000-000000000013',
  sitework: '20000000-0000-4000-8000-000000000014',
};

export const seedCategories: OptionCategory[] = [
  { id: C.ub, code: 'ub', name: 'ユニットバス（UB）', description: '浴室ユニット。いずれか1つ', selection_mode: 'single', is_required: false, sort_order: 1, status: 'published' },
  { id: C.toilet, code: 'toilet', name: 'トイレ', description: null, selection_mode: 'multi', is_required: false, sort_order: 2, status: 'published' },
  { id: C.washbasin, code: 'washbasin', name: '洗面', description: null, selection_mode: 'multi', is_required: false, sort_order: 3, status: 'published' },
  { id: C.kitchen, code: 'kitchen', name: 'キッチン', description: null, selection_mode: 'multi', is_required: false, sort_order: 4, status: 'published' },
  { id: C.interior, code: 'interior', name: '内装材（床・壁・天井）', description: '内装仕上げのセット', selection_mode: 'single', is_required: true, sort_order: 5, status: 'published' },
  { id: C.carpentry, code: 'carpentry', name: '造作工事', description: '室内造作（建具取付まで）', selection_mode: 'single', is_required: true, sort_order: 6, status: 'published' },
  { id: C.fixtures, code: 'fixtures', name: '備品', description: null, selection_mode: 'multi', is_required: false, sort_order: 7, status: 'published' },
  { id: C.lighting, code: 'lighting', name: '照明器具', description: '照明器具は電気設備工事（別途工事）に含みます', selection_mode: 'multi', is_required: false, sort_order: 8, status: 'published' },
  { id: C.boiler, code: 'boiler', name: 'ボイラー・給湯', description: null, selection_mode: 'multi', is_required: false, sort_order: 9, status: 'published' },
  { id: C.other, code: 'other', name: 'その他', description: '空調・断熱・鍵など', selection_mode: 'multi', is_required: false, sort_order: 10, status: 'published' },
  { id: C.exteriorParts, code: 'exterior-parts', name: '付属商品：外構部品', description: 'ウッドデッキ・サンルーフ等', selection_mode: 'multi', is_required: false, sort_order: 11, status: 'published' },
  { id: C.furniture, code: 'furniture', name: '付属商品：家具', description: 'テーブル・ベッド等', selection_mode: 'multi', is_required: false, sort_order: 12, status: 'published' },
  { id: C.appliances, code: 'appliances', name: '付属商品：家電', description: '冷蔵庫・洗濯機等', selection_mode: 'multi', is_required: false, sort_order: 13, status: 'published' },
  { id: C.sitework, code: 'sitework', name: '別途工事（現地施工）', description: '設置場所の確認後、代理店がお見積りします。見積書には「別途」として記載されます', selection_mode: 'multi', is_required: false, sort_order: 14, status: 'published' },
];

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const O = {
  // 共通: 設備
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
  // 付属商品
  woodDeck: id(17),
  sunroof: id(18),
  table: id(19),
  fridge: id(20),
  washer: id(21),
  // モデル別
  interiorStdWing: id(30),
  interiorHotelWing: id(31),
  carpentryFullWing: id(32),
  carpentryOfficeWing: id(33),
  insulationUpgradeWing: id(34),
  interiorStdBox: id(40),
  carpentryBox: id(41),
  interiorStdFlat: id(50),
  carpentryFlat: id(51),
  // 別途工事
  swTransport: id(60),
  swDesignPermit: id(61),
  swPacking: id(62),
  swSiteInstall: id(63),
  swElectric: id(64),
  swPlumbing: id(65),
  swFoundation: id(66),
  swDisposal: id(67),
  swSiteExpense: id(68),
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
  status: 'published',
  created_at: NOW,
  updated_at: NOW,
  ...p,
});

const sitework = (oid: string, code: string, name: string, description: string | null, sort: number) =>
  opt({ id: oid, category_id: C.sitework, code, name, description, price: 0, is_installation: true, price_on_request: true, is_default: true, is_required: true, sort_order: sort });

export const seedOptions: ProductOption[] = [
  // ---- ユニットバス（単一選択） ----
  opt({ id: O.ub1216, category_id: C.ub, code: 'ub-1216', name: 'ユニットバス 1216（浴槽付）', description: '浴槽付きのユニットバス 1216 サイズ。トイレ・洗面は別途選択。', price: 570000, selection_type: 'radio', preview_key: 'bath', affects_views: ['floorplan', 'water'], sort_order: 1 }),
  opt({ id: O.ub3point, category_id: C.ub, code: 'ub-3point-1216', name: '3点ユニットバス 1216（浴槽・トイレ・洗面一体）', description: '浴槽・トイレ・洗面器が一体になった 3点ユニット。洗面器の追加は不要です。', price: 510000, selection_type: 'radio', image_url: '/images/interior/unit-bath-3point.jpg', preview_key: 'ub3', affects_views: ['floorplan', 'water'], sort_order: 2 }),
  opt({ id: O.showerUnit, category_id: C.ub, code: 'shower-unit-1116', name: 'シャワーユニット 1116', description: '浴槽なしのシャワーユニット。BOX のホテル仕様で採用。', price: 810000, selection_type: 'radio', preview_key: 'shower', affects_views: ['floorplan', 'water'], sort_order: 3 }),
  opt({ id: O.showerToiletUnit, category_id: C.ub, code: 'shower-toilet-unit-1116', name: 'シャワートイレユニット 1116', description: 'シャワーとトイレが一体になったコンパクトユニット。', price: 510000, selection_type: 'radio', preview_key: 'shower', affects_views: ['floorplan', 'water'], sort_order: 4 }),

  // ---- トイレ ----
  opt({ id: O.toiletWashlet, category_id: C.toilet, code: 'toilet-washlet', name: 'トイレ（温水洗浄便座ウォッシュレット）', description: '温水洗浄便座付きトイレ。', price: 225000, preview_key: 'toilet', affects_views: ['floorplan'], sort_order: 1 }),

  // ---- 洗面 ----
  opt({ id: O.washbasinKb, category_id: C.washbasin, code: 'washbasin-kb', name: '洗面器 KB-PR012-03-G141', description: 'ボウル型洗面器（toolbox）。', price: 69225, preview_key: 'washbasin', affects_views: ['floorplan', 'water'], sort_order: 1 }),
  opt({ id: O.faucetKb, category_id: C.washbasin, code: 'faucet-kb', name: '混合水栓 KB-TP006-01-G141', description: '洗面器用の混合水栓（toolbox）。洗面器と合わせて選択します。', price: 90000, sort_order: 2 }),

  // ---- キッチン ----
  opt({ id: O.miniKitchen, category_id: C.kitchen, code: 'mini-kitchen', name: 'ミニキッチン', description: 'シンク・コンロ付きのコンパクトキッチン。', price: 187500, image_url: '/images/interior/wing-room-kitchen.jpg', preview_key: 'kitchen', affects_views: ['interior', 'floorplan'], sort_order: 1 }),

  // ---- 内装材（モデル別・単一選択・必須） ----
  opt({ id: O.interiorStdWing, base_model_id: MODEL_WING01_ID, category_id: C.interior, code: 'interior-standard-wing', name: '標準内装セット（床フローリング・壁天井クロス）', description: '床フローリング 16.24㎡、壁クロス 41.71㎡、天井クロス 16.24㎡、ラワンべニア下地。', price: 515890, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.interiorHotelWing, base_model_id: MODEL_WING01_ID, category_id: C.interior, code: 'interior-hotel-wing', name: 'ホテル仕様内装（ラワン板張り・モクタイル床）', description: '床モクタイルラワン、壁モクボードラワン 5mm、天井ラワンべニア＋クロス、Pタイル。', price: 613338, selection_type: 'radio', sort_order: 2 }),
  opt({ id: O.interiorStdBox, base_model_id: MODEL_BOX_ID, category_id: C.interior, code: 'interior-standard-box', name: '標準内装セット（床フローリング・壁天井クロス）', description: '床フローリング 10.56㎡、壁クロス 30.8㎡、天井クロス・ラワン合板 7.38㎡。', price: 321654, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.interiorStdFlat, base_model_id: MODEL_FLAT_ID, category_id: C.interior, code: 'interior-standard-flat', name: '標準内装セット（床フローリング・壁天井クロス）', description: '床フローリング 16.24㎡、壁クロス 30.8㎡、天井クロス・ラワンべニア 16.24㎡。', price: 461163, selection_type: 'radio', is_default: true, sort_order: 1 }),

  // ---- 造作工事（モデル別・単一選択・必須） ----
  opt({ id: O.carpentryFullWing, base_model_id: MODEL_WING01_ID, category_id: C.carpentry, code: 'carpentry-full-wing', name: '室内造作工事（住宅・ホテル仕様）', description: '建具取付までの室内造作 12.5人工。水まわり設備ありの構成向け。', price: 312500, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.carpentryOfficeWing, base_model_id: MODEL_WING01_ID, category_id: C.carpentry, code: 'carpentry-office-wing', name: '室内造作工事（事務所仕様）', description: '建具取付までの室内造作 7.5人工。水まわり設備なしの構成向け。', price: 187500, selection_type: 'radio', sort_order: 2 }),
  opt({ id: O.carpentryBox, base_model_id: MODEL_BOX_ID, category_id: C.carpentry, code: 'carpentry-box', name: '室内造作工事', description: '建具取付までの室内造作 3.19人工。', price: 79750, selection_type: 'radio', is_default: true, sort_order: 1 }),
  opt({ id: O.carpentryFlat, base_model_id: MODEL_FLAT_ID, category_id: C.carpentry, code: 'carpentry-flat', name: '室内造作工事', description: '建具取付までの室内造作 7.5人工。', price: 187500, selection_type: 'radio', is_default: true, sort_order: 1 }),

  // ---- 備品 ----
  opt({ id: O.shoeBox, category_id: C.fixtures, code: 'shoe-box', name: '家具下足箱', description: '玄関の下足箱（造作家具）。', price: 112500, sort_order: 1 }),
  opt({ id: O.hangerPipe, category_id: C.fixtures, code: 'hanger-pipe', name: 'ハンガーパイプ（取付金物共）', description: 'クローゼット用ハンガーパイプ。', price: 0, sort_order: 2 }),
  opt({ id: O.coatRack, category_id: C.fixtures, code: 'coat-rack', name: '洋服掛け 15×15', description: null, price: 64500, sort_order: 3 }),

  // ---- 照明器具 ----
  opt({ id: O.lightingExtra, category_id: C.lighting, code: 'lighting-extra', name: '照明器具（電気設備工事に含む）', description: '照明器具は現地の電気設備工事（別途工事）に含めてお見積りします。ご希望があればご要望欄にご記入ください。', price: 0, price_on_request: true, sort_order: 1 }),

  // ---- ボイラー・給湯 ----
  opt({ id: O.gasBoiler, category_id: C.boiler, code: 'gas-boiler-16', name: 'ガス給湯器 16号', description: 'ユニットバス・シャワー・キッチンの給湯に必要です。', price: 270000, sort_order: 1 }),

  // ---- その他 ----
  opt({ id: O.aircon, category_id: C.other, code: 'aircon', name: 'エアコン', description: '壁掛け式ルームエアコン 1台。', price: 375000, image_url: '/images/interior/wing-room-aircon.jpg', preview_key: 'aircon', affects_views: ['interior', 'floorplan'], sort_order: 1 }),
  opt({ id: O.smartKey, category_id: C.other, code: 'smart-key', name: 'スマートキー', description: '玄関ドアのスマートキー。', price: 52500, sort_order: 2 }),
  opt({ id: O.insulationUpgradeWing, base_model_id: MODEL_WING01_ID, category_id: C.other, code: 'insulation-upgrade-wing', name: '高断熱仕様（スタイロフォーム 90mm）', description: '床・壁・天井の断熱材をグラスウールからスタイロフォーム 90mm に変更（ホテルUB仕様）。', price: 235278, sort_order: 3 }),

  // ---- 付属商品 ----
  opt({ id: O.woodDeck, category_id: C.exteriorParts, code: 'wood-deck', name: 'ウッドデッキ', description: '正面に広がるウッドデッキ。※価格は仮置きです。', price: 450000, image_url: '/images/products/wing-lakeside-deck.jpg', preview_key: 'deck', affects_views: ['exterior', 'floorplan'], sort_order: 1 }),
  opt({ id: O.sunroof, category_id: C.exteriorParts, code: 'sunroof', name: 'サンルーフ', description: '設置条件により別途お見積り。', price: 0, price_on_request: true, sort_order: 2 }),
  opt({ id: O.foldingBed, category_id: C.furniture, code: 'folding-bed', name: '折り畳み式ベッド 1200×2000', description: null, price: 120000, sort_order: 1 }),
  opt({ id: O.table, category_id: C.furniture, code: 'table', name: 'テーブル', description: 'サイズ・仕様により別途お見積り。', price: 0, price_on_request: true, sort_order: 2 }),
  opt({ id: O.fridge, category_id: C.appliances, code: 'fridge', name: '冷蔵庫', description: '機種により別途お見積り。', price: 0, price_on_request: true, sort_order: 1 }),
  opt({ id: O.washer, category_id: C.appliances, code: 'washer', name: '洗濯機', description: '機種により別途お見積り。', price: 0, price_on_request: true, sort_order: 2 }),

  // ---- 別途工事（常に見積書に「別途」として記載） ----
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
];

/**
 * プレビュー画像ルール（Wing のみ。BOX・フラットは画像未提供のため未登録）。
 * 手元にある正規素材に写っている設備だけを正直に登録する。
 */
export const seedPreviewRules: PreviewImageRule[] = [
  // ---- Wing 外観（同一構図でデッキあり／なし） ----
  { id: '60000000-0000-4000-8000-000000000001', base_model_id: MODEL_WING01_ID, view: 'exterior', kind: 'composite', preview_keys: [], url: '/images/products/wing-lakeside.jpg', alt: '標準外観（デッキなし）', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000002', base_model_id: MODEL_WING01_ID, view: 'exterior', kind: 'composite', preview_keys: ['deck'], url: '/images/products/wing-lakeside-deck.jpg', alt: 'ウッドデッキ付き外観', note: null, z_index: 0, status: 'published' },
  // ---- Wing 室内 ----
  { id: '60000000-0000-4000-8000-000000000003', base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: [], url: '/images/interior/bedroom-seaview.webp', alt: '標準内装の居室（エアコン・キッチンなし）', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000004', base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/wing-room-aircon.jpg', alt: 'エアコン付きの居室', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000007', base_model_id: MODEL_WING01_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon', 'kitchen'], url: '/images/interior/wing-room-kitchen.jpg', alt: 'エアコンとミニキッチン付きの居室', note: null, z_index: 0, status: 'published' },
  // ---- Wing 水まわり ----
  { id: '60000000-0000-4000-8000-000000000005', base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['washbasin'], url: '/images/interior/washroom.webp', alt: '洗面器のある水まわり', note: 'ユニットバス・トイレは写っていません', z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000008', base_model_id: MODEL_WING01_ID, view: 'water', kind: 'composite', preview_keys: ['ub3'], url: '/images/interior/unit-bath-3point.jpg', alt: '3点ユニットバス（浴槽・トイレ・洗面器）', note: null, z_index: 0, status: 'published' },
  // ---- Wing 平面図 ----
  { id: '60000000-0000-4000-8000-000000000006', base_model_id: MODEL_WING01_ID, view: 'floorplan', kind: 'composite', preview_keys: ['aircon', 'shower', 'toilet', 'washbasin'], url: '/images/floorplan/wing01-plan-full.jpg', alt: 'シャワー・トイレ・洗面・エアコン構成の平面図', note: 'デッキは緑線（オプション）として図示', z_index: 0, status: 'published' },
  // ---- BOX ----
  { id: '60000000-0000-4000-8000-000000000021', base_model_id: MODEL_BOX_ID, view: 'exterior', kind: 'composite', preview_keys: [], url: '/images/products/box-forest-lake.jpg', alt: 'BOX 標準外観', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000022', base_model_id: MODEL_BOX_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/room-white-aircon.jpg', alt: 'エアコン付きの室内', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000023', base_model_id: MODEL_BOX_ID, view: 'water', kind: 'composite', preview_keys: ['ub3'], url: '/images/interior/unit-bath-3point.jpg', alt: '3点ユニットバス', note: null, z_index: 0, status: 'published' },
  // ---- フラット ----
  { id: '60000000-0000-4000-8000-000000000031', base_model_id: MODEL_FLAT_ID, view: 'exterior', kind: 'composite', preview_keys: [], url: '/images/products/flat-office-lake.jpg', alt: 'フラット 標準外観', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000032', base_model_id: MODEL_FLAT_ID, view: 'interior', kind: 'composite', preview_keys: ['aircon'], url: '/images/interior/room-white-aircon.jpg', alt: 'エアコン付きの室内', note: null, z_index: 0, status: 'published' },
  { id: '60000000-0000-4000-8000-000000000033', base_model_id: MODEL_FLAT_ID, view: 'water', kind: 'composite', preview_keys: ['ub3'], url: '/images/interior/unit-bath-3point.jpg', alt: '3点ユニットバス', note: null, z_index: 0, status: 'published' },
];

export const seedCatalog = {
  models: seedModels,
  images: seedProductImages,
  categories: seedCategories,
  options: seedOptions,
  dependencies: seedDependencies,
  conflicts: seedConflicts,
  previewRules: seedPreviewRules,
};
