/**
 * 実受注案件「パパマハロ様葛飾2丁目貸家新築工事」を
 * 本番DBへ触れず、ローカル案件管理画面で再現する検証fixture。
 *
 * 実行:
 *   npm run seed:kameari-case
 *
 * ローカルDB(.wing-local/db.json)をこのfixture用に初期化する。
 * 実案件の見積・図面から転記した検証用データであり、本番データではない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { seedCatalog, MODEL_BOX_ID } from '../lib/seed/catalog.ts';

const dir = path.resolve(process.cwd(), process.env.WING_LOCAL_DIR || '.wing-local');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const IDS = {
  customer: '81000000-0000-4000-8000-000000000001',
  dealer: '81000000-0000-4000-8000-000000000002',
  admin: '81000000-0000-4000-8000-000000000003',
  configuration: '82000000-0000-4000-8000-000000000001',
  request: '83000000-0000-4000-8000-000000000001',
  quote: '84000000-0000-4000-8000-000000000001',
};

const ISSUED_AT = '2026-09-20T00:00:00.000Z';
const VALID_UNTIL = '2026-10-20T00:00:00.000Z';
const SITE_ADDRESS = '東京都葛飾区亀有2丁目39-8';
const salt = 'kameari-real-case-local-fixture';

function user(id: string, email: string, password: string) {
  return {
    id,
    email,
    password_hash: scryptSync(password, salt, 64).toString('hex'),
    salt,
    created_at: ISSUED_AT,
  };
}

const users = [
  user(IDS.customer, 'papa-mahalo-kameari@example.invalid', 'Wing-Customer1!'),
  user(IDS.dealer, 'chiyokawa-kameari@example.invalid', 'Wing-Dealer1!'),
  user(IDS.admin, 'admin@example.com', 'Wing-Admin1!'),
];

const profiles = [
  {
    id: IDS.customer,
    customer_no: 'C-KAMEARI-001',
    email: 'papa-mahalo-kameari@example.invalid',
    full_name: '伊藤 史織',
    company_name: '株式会社 パパマハロ',
    phone: null,
    postal_code: null,
    address: null,
    role_code: 'customer',
    created_at: ISSUED_AT,
    updated_at: ISSUED_AT,
  },
  {
    id: IDS.dealer,
    customer_no: null,
    email: 'chiyokawa-kameari@example.invalid',
    full_name: '千代川',
    company_name: '株式会社 技術の杜',
    phone: null,
    postal_code: null,
    address: null,
    role_code: 'master_dealer',
    created_at: ISSUED_AT,
    updated_at: ISSUED_AT,
  },
  {
    id: IDS.admin,
    customer_no: null,
    email: 'admin@example.com',
    full_name: '管理者',
    company_name: '株式会社 技術の杜',
    phone: null,
    postal_code: null,
    address: null,
    role_code: 'admin',
    created_at: ISSUED_AT,
    updated_at: ISSUED_AT,
  },
];

function option(code: string) {
  const found = seedCatalog.options.find((row) => row.code === code);
  if (!found) throw new Error(`商品コードが見つかりません: ${code}`);
  return found;
}

function defaultVariantIds(optionId: string) {
  return seedCatalog.variantGroups
    .filter((group) => group.option_id === optionId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((group) => {
      const choices = seedCatalog.variantChoices
        .filter((choice) => choice.group_id === group.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      const picked = choices.find((choice) => choice.kind === 'standard' || choice.kind === 'fixed') ?? choices[0];
      return picked ? [picked.id] : [];
    });
}

const selectedCodes = [
  'fire-proof',
  'floor-light-beige',
  'wall-ceiling-cross',
  'exterior-galnote',
  'door-standard',
  'interior-standard-box',
  'carpentry-box',
  'shower-unit-1116',
  'mini-kitchen',
  'gas-boiler-16',
  'shoe-box',
  'fridge',
  'lighting-downlight',
  'sw-transport',
  'sw-design-permit',
  'sw-packing',
  'sw-site-install',
  'sw-electric',
  'sw-plumbing',
  'sw-foundation',
  'sw-site-expense',
];

const selectedOptions = selectedCodes.map(option);
const exterior = option('exterior-galnote');
const exteriorVariantIds = defaultVariantIds(exterior.id);

const configuration = {
  id: IDS.configuration,
  user_id: IDS.customer,
  base_model_id: MODEL_BOX_ID,
  name: 'パパマハロ様 葛飾2丁目貸家新築工事',
  status: 'closed',
  finish_level: 'full',
  spec_code: 'hotel-single',
  site_prefecture: '東京都',
  site_municipality: '葛飾区',
  site_location_undecided: false,
  base_price: 1205898,
  base_expense: 180884,
  option_subtotal: 4106588,
  option_expense: 615988,
  installation_subtotal: 2260440,
  adjustment: -9798,
  subtotal: 8360000,
  tax: 836000,
  total: 9196000,
  preview_image_url: null,
  notes: 'BOX（防火構造）2階建て・屋外階段付き。実案件ローカル検証用。',
  partner_id: IDS.dealer,
  exterior_faces: ['front', 'right', 'back', 'left'].map((face_code) => ({
    face_code,
    option_id: exterior.id,
    variant_choice_ids: exteriorVariantIds,
  })),
  created_at: ISSUED_AT,
  updated_at: ISSUED_AT,
};

const configurationItems = selectedOptions.map((row, index) => ({
  id: `85000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  configuration_id: IDS.configuration,
  option_id: row.id,
  quantity: row.code === 'shower-unit-1116' || row.code === 'mini-kitchen' ? 2 : 1,
  variant_choice_ids: defaultVariantIds(row.id),
}));

const quoteRequest = {
  id: IDS.request,
  configuration_id: IDS.configuration,
  user_id: IDS.customer,
  quote_id: IDS.quote,
  status: 'closed',
  message:
    '受注済み実案件。BOX（防火構造）2階建て・屋外階段付き。都市計画区域は市街化区域。用途地域は第一種住居地域。第2種高度地区。準防火地域。建蔽率60%、容積率200%。日影規制は対象建物10m超、5m超〜10mは4時間、10m超は2.5時間、測定面4m。遺跡対象地域は遺跡地及び行政指導範囲。配置図の道路幅員4,000mm、道路境界線あり。搬入条件・地盤条件は未確認。都市計画資料は参考図のため正式判断は所管課確認。',
  contact: {
    full_name: '伊藤 史織',
    company_name: '株式会社 パパマハロ',
    email: 'papa-mahalo-kameari@example.invalid',
    phone: '',
    address: '',
    site_address: SITE_ADDRESS,
  },
  created_at: ISSUED_AT,
  updated_at: ISSUED_AT,
};

const quote = {
  id: IDS.quote,
  quote_no: 'TEST-KAMEARI-20260920',
  quote_request_id: IDS.request,
  configuration_id: IDS.configuration,
  user_id: IDS.customer,
  status: 'accepted',
  issued_at: ISSUED_AT,
  valid_until: VALID_UNTIL,
  customer_no: 'C-KAMEARI-001',
  customer_name: '伊藤 史織',
  customer_company: '株式会社 パパマハロ',
  base_model_name: 'BOX',
  finish_level: 'full',
  base_price: 1205898,
  base_expense: 180884,
  option_subtotal: 4106588,
  option_expense: 615988,
  installation_subtotal: 2260440,
  adjustment: -9798,
  subtotal: 8360000,
  tax_rate: 0.1,
  tax: 836000,
  total: 9196000,
  dealer_id: IDS.dealer,
  dealer_note:
    'BOX 2台（1階1台＋2階1台）・防火構造・2階建て・屋外鉄骨階段付き。外構工事・ゴミステーションは別途工事。設置予定地は東京都葛飾区亀有2丁目39-8。',
  revision: 1,
  parent_quote_id: null,
  preview_image_url: null,
  notes: '受注契約日 2026/9/20。支払条件：工事完了後元請入金確認後1週間以内振込支払い。',
  created_at: ISSUED_AT,
  updated_at: ISSUED_AT,
};

let quoteItemSeq = 0;
const quoteItems: Record<string, unknown>[] = [];
function addItem(
  kind: string,
  name: string,
  description: string | null,
  unit: string,
  unitPrice: number,
  quantity: number,
  amount: number,
  remark: string | null,
  sortOrder: number
) {
  quoteItemSeq += 1;
  quoteItems.push({
    id: `86000000-0000-4000-8000-${String(quoteItemSeq).padStart(12, '0')}`,
    quote_id: IDS.quote,
    kind,
    name,
    description,
    unit,
    remark,
    unit_price: unitPrice,
    quantity,
    amount,
    image_url: null,
    sort_order: sortOrder,
  });
}

function addReferenceItem(
  kind: string,
  name: string,
  description: string | null,
  unit: string,
  quantity: number,
  referenceUnitPrice: number,
  remark: string | null,
  sortOrder: number
) {
  addItem(
    kind,
    name,
    description,
    unit,
    0,
    quantity,
    0,
    `参考単価 ${referenceUnitPrice.toLocaleString('ja-JP')}円／見積額なし${remark ? `／${remark}` : ''}`,
    sortOrder
  );
}

// 本体（2台分）
addItem('base', '単管パイプ3m', '1．金物関係費用', '本', 2266, 12, 27192, null, 10);
addItem('base', 'タルキ止めクランプ', '1．金物関係費用', '個', 263, 12, 3156, null, 11);
addItem('base', 'ジャッキベース', '1．金物関係費用', '本', 3500, 12, 42000, null, 12);
addItem('base', 'ジャッキベース用カバー', '1．金物関係費用', '枚', 1330, 12, 15960, null, 13);
addItem('base', 'その他の金物', '1．金物関係費用', '枚', 714, 8, 5712, null, 14);

addItem('base', '204材L=6f', '2．プレカット（木材費）', '本', 889, 92, 81788, '床天井根太', 20);
addItem('base', '204材L=8f', '2．プレカット（木材費）', '本', 1184, 100, 118400, '壁用', 21);
addReferenceItem('base', '204材L=12f', '2．プレカット（木材費）', '本', 2, 1778, '上下枠根太破風', 22);
addItem('base', '204材L=16f', '2．プレカット（木材費）', '本', 2370, 24, 56880, '同上', 23);
addItem('base', '204材L=12f（屋根タルキ）', '2．プレカット（木材費）', '本', 1778, 8, 14224, '屋根タルキ', 24);
addItem('base', '104材柱パイプ囲み用', '2．プレカット（木材費）', '本', 506, 20, 10120, null, 25);
addItem('base', '下地野縁30×40（9本入り）', '2．プレカット（木材費）', '本', 908, 18, 16344, null, 26);
addItem('base', '防腐剤塗り', '2．プレカット（木材費）', '式', 11200, 2, 22400, null, 27);
addItem('base', '本体組立費', '2．プレカット（木材費）', '人', 35000, 10, 350000, null, 28);

addItem('base', 'OSB合板9×910×2,420', '3．外部面材等', '枚', 2851, 32, 91232, null, 30);
addItem('base', 'ラワンべニア×910×1,820', '3．外部面材等', '枚', 2139, 14, 29946, null, 31);
addItem('base', '防湿シート50m巻き', '3．外部面材等', '本', 1680, 2, 3360, null, 32);
addItem('base', '合板施工費', '3．外部面材等', '人', 35000, 2, 70000, null, 33);

addItem('base', '床用ミラフォーム90㎜', '5．断熱材', '枚', 9021, 17, 153356, null, 40);
addItem('base', '壁グラスウール91㎜', '5．断熱材', '坪', 2234, 20, 44680, null, 41);
addItem('base', '天井グラスウール92㎜', '5．断熱材', '坪', 2234, 22, 49148, null, 42);
addItem('base_expense', '本体諸費用', '交通費、労災、安全管理費等', '式', 90442, 2, 180884, null, 900);

// 内外装（2台分）
addReferenceItem('interior_exterior', '木製建具（クローゼット）', '1．サッシ木製建具工事', '枚', 2, 63000, '収納分', 1000);
addItem('interior_exterior', 'サッシ', '1．サッシ木製建具工事', '台', 210000, 2, 420000, null, 1001);
addItem('interior_exterior', '（原見積：品名記載なし）', '1．サッシ木製建具工事', '式', 175000, 2, 350000, '原見積の175,000円/台行', 1002);

addReferenceItem('interior_exterior', '屋根ガルバニュウム鋼板', '2．屋根外壁工事', 'm', 47, 0, '4.5m×5本 素地', 1100);
addReferenceItem('interior_exterior', '取外し水切り 糸長150㎜ 4m', '2．屋根外壁工事', '本', 10, 0, 'L=2,300㎜', 1101);
addReferenceItem('interior_exterior', '外壁角スパンガルバ鋼板', '2．屋根外壁工事', '㎡', 82, 0, 'L=2,300㎜', 1102);
addReferenceItem('interior_exterior', '唐草下がり40㎜ L=3m', '2．屋根外壁工事', '本', 12, 0, null, 1103);
addItem('interior_exterior', '上記ガルバニュウム鋼板関係', '2．屋根外壁工事', '式', 146357, 2, 292714, null, 1104);
addReferenceItem('interior_exterior', '下見板張り（防腐剤塗り共）', '2．屋根外壁工事', '㎡', 2, 10920, null, 1105);
addItem('interior_exterior', '外壁張り手間', '2．屋根外壁工事', '人', 35000, 6, 210000, null, 1106);

addItem('interior_exterior', '床フローリング', '3．内装仕上げ', 'ケース', 13720, 21.12, 289766, 'クリア塗装品', 1200);
addItem('interior_exterior', '壁クロス仕上げ', '3．内装仕上げ', '㎡', 2800, 61.6, 172480, '910×2,420', 1201);
addItem('interior_exterior', '天井クロス仕上げ', '3．内装仕上げ', '㎡', 2800, 14.76, 41328, '910×2,420', 1202);
addItem('interior_exterior', '内装仕上げ施工費', '3．内装仕上げ', '人', 35000, 12.18, 426300, null, 1203);
addItem('interior_exterior_expense', '内外装工事経費', '交通費、労災、安全管理費等', '式', 165194, 2, 330388, null, 1950);

// 防火仕様は現行画面ルールに合わせ option のまま本体欄へ表示
addItem('option', '防火仕様（防火構造）', '準防火地域対応', '式', 0, 2, 0, '設置地：準防火地域', 1990);

// オプション（2台分）
addItem('option', 'シャワーユニット1116', '1．設備機器', '台', 756000, 2, 1512000, null, 2000);
addReferenceItem('option', 'ウォッシュレット', '1．設備機器', '台', 2, 210000, null, 2001);
addItem('option', 'ミニキッチン', '1．設備機器', '台', 175000, 2, 350000, null, 2002);
addReferenceItem('option', 'エアコン', '1．設備機器', '台', 2, 350000, null, 2003);
addReferenceItem('option', 'ガス給湯器16号', '1．設備機器', '台', 2, 252000, null, 2004);
addReferenceItem('option', 'スマートキー', '1．設備機器', '台', 2, 49000, null, 2005);
addItem('option', 'ハンガーパイプ（取付金物共）', '1．設備機器', 'セット', 0, 2, 0, '見積額なし', 2006);
addItem('option', '洋服掛け15×15', '1．設備機器', 'セット', 0, 2, 0, '見積額なし', 2007);
addReferenceItem('option', '洗面器KB-PR012-03-G141', '1．設備機器', '台', 2, 64610, 'toolbox', 2008);
addReferenceItem('option', '混合水栓KB-TP006-01-G141', '1．設備機器', '台', 2, 84000, 'toolbox', 2009);
addReferenceItem('option', '造り付けベット1200×2000', '1．設備機器', '台', 2, 112000, null, 2010);
addReferenceItem('option', '室内造作（建具取付まで）', '1．設備機器', '人', 2, 25000, null, 2011);
addItem('option', '各種養生（床養生マット、壁ビニールシート等）', '4．各種養生', '式', 21000, 2, 42000, null, 2100);
addItem('option_expense', 'オプション諸費用', '原見積の142,800円/台行', '式', 142800, 2, 285600, null, 2950);

// 現場工事（2台分）
addItem('installation', '運送費', '1．運送費', '式', 168000, 2, 336000, '1台当りで試算', 3000);
addItem('installation', '設計監理及び確認申請費', '2．設計監理及び確認申請費', '式', 119000, 2, 238000, '1台当り', 3001);
addItem('installation', '梱包養生', '3．梱包養生', '式', 16800, 2, 33600, '1台当り', 3002);
addItem('installation', '現場設置工事', '4．現場設置工事', '式', 119000, 2, 238000, '1台当り', 3003);
addItem('installation', '電気設備工事', '5．電気設備工事', '式', 91000, 2, 182000, '照明器具含む／1台当り', 3004);
addItem('installation', '給排水給湯設備工事', '6．給排水給湯設備工事', '式', 168000, 2, 336000, '敷地状況によって別途見積／1台当り', 3005);
addItem('installation', '基礎工事（設置後工事）', '7．基礎工事', '式', 168000, 2, 336000, '1台当り', 3006);
addItem('installation', '外部鉄骨階段', '8．外部鉄骨階段', '式', 133000, 2, 266000, '1台当り', 3007);
addItem('installation', '別途現場諸費用', '9．別途現場諸費用', '式', 147420, 2, 294840, '交通費、労災、安全管理費等', 3008);

const caseDocuments = [
  {
    id: '87000000-0000-4000-8000-000000000001',
    quote_id: IDS.quote,
    kind: 'floorplan',
    title: '1階・2階 平面図',
    file_name: 'kameari_floorplans.png',
    url: '/images/cases/kameari-test/floorplans.png',
    preview_url: '/images/cases/kameari-test/floorplans.png',
    document_date: '2026-09-12',
    revision_label: '図面Ver2',
    is_latest: true,
    note: '実案件図面から切り出した平面図。1階・2階を同一画像で確認。',
    sort_order: 10,
  },
  {
    id: '87000000-0000-4000-8000-000000000002',
    quote_id: IDS.quote,
    kind: 'elevation',
    title: '南側立面図',
    file_name: 'kameari_elevation_south.png',
    url: '/images/cases/kameari-test/elevation-south.png',
    preview_url: '/images/cases/kameari-test/elevation-south.png',
    document_date: '2026-09-12',
    revision_label: '図面Ver2',
    is_latest: true,
    note: null,
    sort_order: 20,
  },
  {
    id: '87000000-0000-4000-8000-000000000003',
    quote_id: IDS.quote,
    kind: 'elevation',
    title: '東側立面図',
    file_name: 'kameari_elevation_east.png',
    url: '/images/cases/kameari-test/elevation-east.png',
    preview_url: '/images/cases/kameari-test/elevation-east.png',
    document_date: '2026-09-12',
    revision_label: '図面Ver2',
    is_latest: true,
    note: null,
    sort_order: 21,
  },
  {
    id: '87000000-0000-4000-8000-000000000004',
    quote_id: IDS.quote,
    kind: 'elevation',
    title: '西側立面図',
    file_name: 'kameari_elevation_west.png',
    url: '/images/cases/kameari-test/elevation-west.png',
    preview_url: '/images/cases/kameari-test/elevation-west.png',
    document_date: '2026-09-12',
    revision_label: '図面Ver2',
    is_latest: true,
    note: null,
    sort_order: 22,
  },
  {
    id: '87000000-0000-4000-8000-000000000005',
    quote_id: IDS.quote,
    kind: 'elevation',
    title: '北側立面図',
    file_name: 'kameari_elevation_north.png',
    url: '/images/cases/kameari-test/elevation-north.png',
    preview_url: '/images/cases/kameari-test/elevation-north.png',
    document_date: '2026-09-12',
    revision_label: '図面Ver2',
    is_latest: true,
    note: null,
    sort_order: 23,
  },
  {
    id: '87000000-0000-4000-8000-000000000006',
    quote_id: IDS.quote,
    kind: 'estimate',
    title: '図面見積・注文書',
    file_name: '20260912【図面見積】パパマハロ様葛飾2丁目貸家新築工事(1).pdf',
    url: null,
    preview_url: null,
    document_date: '2026-09-12',
    revision_label: '9/12版',
    is_latest: false,
    note: '今回の添付原本。正式な案件ファイル保管機能は未実装のため、テストではメタ情報のみ保持。',
    sort_order: 30,
  },
  {
    id: '87000000-0000-4000-8000-000000000007',
    quote_id: IDS.quote,
    kind: 'estimate',
    title: '見積書',
    file_name: '20260920【見積】パパマハロ様葛飾2丁目貸家新築工事(1).pdf',
    url: null,
    preview_url: null,
    document_date: '2026-09-20',
    revision_label: '9/20版',
    is_latest: true,
    note: '税込9,196,000円の最新見積原本。正式な案件ファイル保管機能は未実装のため、テストではメタ情報のみ保持。',
    sort_order: 31,
  },
  {
    id: '87000000-0000-4000-8000-000000000008',
    quote_id: IDS.quote,
    kind: 'site',
    title: '配置・敷地図',
    file_name: '葛飾区亀有２丁目39-8 (1)(1).pdf',
    url: null,
    preview_url: null,
    document_date: null,
    revision_label: null,
    is_latest: true,
    note: '道路幅員4,000mm・道路境界線等を確認する敷地資料。接道の正式条件は要確認。正式ファイル保管は次工程。',
    sort_order: 40,
  },
  {
    id: '87000000-0000-4000-8000-000000000009',
    quote_id: IDS.quote,
    kind: 'site',
    title: '都市計画情報',
    file_name: '亀有2丁目　都市計画情報(1).pdf',
    url: null,
    preview_url: null,
    document_date: null,
    revision_label: null,
    is_latest: true,
    note: '市街化区域・第一種住居地域・第2種高度地区・建蔽率60%・容積率200%・準防火地域・日影規制・遺跡対象地域を確認する参考資料。詳細は所管課確認。正式ファイル保管は次工程。',
    sort_order: 41,
  },
];

const db = {
  users,
  profiles,
  models: seedCatalog.models,
  images: seedCatalog.images,
  categories: seedCatalog.categories,
  options: seedCatalog.options,
  optionImages: [],
  dependencies: seedCatalog.dependencies,
  conflicts: seedCatalog.conflicts,
  previewRules: seedCatalog.previewRules,
  hotspots: seedCatalog.hotspots,
  variantGroups: seedCatalog.variantGroups,
  variantChoices: seedCatalog.variantChoices,
  baseBreakdownItems: seedCatalog.baseBreakdownItems,
  estimateTemplates: [],
  estimateTemplateSections: [],
  estimateTemplateLines: [],
  configurations: [configuration],
  configurationItems,
  snapshots: [],
  quoteRequests: [quoteRequest],
  quotes: [quote],
  quoteItems,
  quoteDocuments: [],
  caseDocuments,
  quoteSequences: { '202609': 1 },
  resetTokens: [],
  contactMessages: [],
  notifications: [],
  auditLogs: [],
};

fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db, null, 2), 'utf8');

console.log(`亀有実案件テストDBを作成しました: ${path.join(dir, 'db.json')}`);
console.log('管理者: admin@example.com / Wing-Admin1!');
console.log('担当者: chiyokawa-kameari@example.invalid / Wing-Dealer1!');
console.log('顧客: papa-mahalo-kameari@example.invalid / Wing-Customer1!');
console.log('案件: パパマハロ様葛飾2丁目貸家新築工事');
console.log('見積: TEST-KAMEARI-20260920 / 承諾 / 税込 9,196,000円');
