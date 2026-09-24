import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forms = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/forms.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);
const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/page.tsx'),
  'utf8'
);
const nav = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'),
  'utf8'
);
const media = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-media-manager.tsx'),
  'utf8'
);
const customerPreview = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-customer-preview.tsx'),
  'utf8'
);
const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);
const adminActions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/admin.ts'),
  'utf8'
);
const catalogSeed = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/seed/catalog.ts'),
  'utf8'
);
const roofCategoryMigration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260924085700_roof_product_category.sql'),
  'utf8'
);
const entranceDoorCategoryMigration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260924092000_entrance_door_product_category.sql'),
  'utf8'
);

describe('商品登録管理画面の業務フロー', () => {
  it('商品登録を入力とお客様表示確認の2つの大きな作業単位にまとめる', () => {
    for (const label of ['商品情報', '登録内容確認']) {
      expect(editPage).toContain(label);
      expect(newPage).toContain(label);
    }
    expect(editPage).toContain('aria-label="商品登録の2ステップ"');
    expect(editPage).toContain('mode="all"');
    expect(editPage).not.toContain('mode="product"');
    expect(editPage).not.toContain('mode="pricing"');
    expect(editPage).toContain('基本情報・メイン画像・価格公開は1つの保存ボタンで保存');
    expect(editPage).toContain('STEP 2 登録内容確認へ');
    expect(editPage).toContain('data-testid="option-registration-info"');
    expect(editPage).toContain('data-testid="option-customer-preview"');
    expect(editPage).not.toContain('発注内容確認');
    expect(editPage).not.toContain('内容確認・登録');
    expect(newPage).not.toContain('内容確認・登録');
    expect(editPage).not.toContain('商品登録の7ステップ');
  });
  it('見積テンプレートからの新規登録も2STEPを完了してから戻る', () => {
    expect(newPage).toContain('商品登録の2ステップ');
    expect(newPage).toContain('まず下書きを作成してSTEP 1を続け');
    expect(newPage).toContain('STEP 2で公開した後に元の見積テンプレートへ戻って商品を追加します。');
    expect(newPage).toContain('return_to');
    expect(forms).not.toContain('下書き登録して見積テンプレートへ戻る');
    expect(forms).toContain('下書きを作成してSTEP 1を続ける');
    expect(forms).toContain("mode === 'all' && option");
    expect(forms).toContain("'商品情報を保存'");
    expect(adminActions).toContain("const returnTo = safeAdminReturnTo(formData.get('return_to'))");
    expect(adminActions).toContain("return_to: returnTo");
    expect(adminActions).toContain("redirect('/admin/options/' + createdId + '?' + params.toString())");
    expect(adminActions).toContain("returnUrl.searchParams.set('created_option', id)");
    expect(editPage).toContain('returnTo={returnTo}');
    expect(editPage).toContain('name="return_to" value={returnTo}');
    expect(editPage).toContain('サブ画像・メーカー資料');
    expect(editPage).toContain('お客様選択');
  });

  it('新規商品は下書きで作成し、お客様表示確認後に明示公開する', () => {
    expect(forms).toContain('カテゴリーを選択してください');
    expect(forms).toContain('新規商品は下書きで保存し、STEP 2のお客様表示を確認してから公開します。');
    expect(adminActions).toContain("status: existingOption?.status === 'published' ? formData.get('status') : 'draft'");
    expect(adminActions).toContain('export async function publishOptionAction');
    expect(adminActions).toContain('const actor = await requireStaff()');
    expect(adminActions).toContain('editableOptionContext(actor, id)');
    expect(adminActions).toContain("status: 'published'");
    expect(editPage).toContain('publishOptionAction');
    expect(editPage).toContain('現在は下書きです。上のお客様表示に問題がなければ公開してください。');
    expect(editPage).toContain('この内容で公開');
    expect(newPage).toContain('続くSTEP 1でサブ画像・メーカー資料・お客様選択まで整えます。');
    expect(newPage).toContain('STEP 2で実際のお客様表示を確認してから公開します。');
    expect(forms).toContain("option?.status === 'published'");
    expect(forms).toContain('下書き商品の公開はSTEP 2のお客様表示を確認してから行います。');
    expect(forms).toContain('下書きへ戻す');
    expect(adminActions).toContain('公開への変更はSTEP 2の publishOptionAction に限定する');
  });

  it('削除操作は通常のヘッダーから外してその他の操作へ退避する', () => {
    expect(editPage).toContain('その他の操作');
    expect(editPage).toContain('商品を削除');
    expect(editPage).not.toContain('actions={catalogEditor');
  });

  it('正式商品とフリー商品の登録導線を分ける', () => {
    expect(newPage).toContain('requestedFreeCategory');
    expect(newPage).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(editPage).toContain("'/admin/free-products'");
    expect(listPage).toContain('catalogOptions');
  });
  it('商品登録中に既存商品の重複候補を自動表示する', () => {
    expect(forms).toContain('findProductDuplicateCandidates');
    expect(forms).toContain('option-duplicate-warning');
    expect(forms).toContain('既存商品に重複候補があります');
    expect(forms).toContain('登録を止める判定ではありません');
    expect(forms).toContain('メーカー＋シリーズ・型番／品番が一致');
    expect(forms).toContain('同一カテゴリー＋メーカー＋商品名が一致');
    expect(forms).toContain('/admin/options/\${candidate.id}');
  });

  it('カテゴリーに応じてメーカー・商品名・主要仕様の入力を支援する', () => {
    expect(forms).toContain('productRegistrationGuidance');
    expect(forms).toContain("ub: {");
    expect(forms).toContain("manufacturers: ['TOTO', 'LIXIL', 'Panasonic'");
    expect(forms).toContain("boiler: {");
    expect(forms).toContain("manufacturers: ['リンナイ', 'ノーリツ', 'パロマ']");
    expect(forms).toContain("aircon: {");
    expect(forms).toContain("'2.2kW（6畳程度）'");
    expect(forms).toContain("'9.0kW（29畳程度）'");
    expect(forms).toContain('option-product-name-suggestions');
    expect(forms).toContain('option-size-note-suggestions');
    expect(forms).toContain('category-registration-guidance');
    expect(forms).toContain('カテゴリー別の入力候補');
    expect(forms).toContain('カテゴリー別候補＋登録済みメーカー');
    expect(forms).toContain('カテゴリー・メーカー・商品名に合う既存値');
  });

  it('残りの商品カテゴリーにも既存設計の入力支援を広げる', () => {
    for (const categoryCode of [
      'roof: {',
      "'exterior-wall': {",
      'floor: {',
      "'wall-ceiling': {",
      "'entrance-door': {",
      'sash: {',
      "'interior-door': {",
      'lighting: {',
      'furniture: {',
      'smartlock: {',
    ]) {
      expect(forms).toContain(categoryCode);
    }
    expect(forms).toContain("manufacturers: ['ケイミュー', 'アイジー工業', 'セキノ興産', '稲垣商事']");
    expect(forms).toContain("'金属屋根'");
    expect(forms).toContain('屋根材は外壁と分けて登録します。');
    expect(catalogSeed).toContain("roof: cid(23)");
    expect(catalogSeed).toContain("cat(C.roof, 'roof', '屋根'");
    expect(catalogSeed).toContain('外壁とは別に商品を選択します');
    expect(roofCategoryMigration).toContain("'roof'");
    expect(roofCategoryMigration).toContain("'20000000-0000-4000-8000-000000000023'::uuid");
    expect(roofCategoryMigration).toContain("where code = 'exterior-wall'");
    expect(forms).toContain("manufacturers: ['ニチハ', 'ケイミュー', 'アイジー工業', '旭トステム外装']");
    expect(forms).toContain("manufacturers: ['DAIKEN', '朝日ウッドテック', 'Panasonic', 'LIXIL', 'EIDAI', 'ウッドワン']");
    expect(forms).toContain("manufacturers: ['サンゲツ', 'リリカラ', 'シンコール', 'トキワ', 'ルノン', 'DAIKEN']");
    expect(forms).toContain("manufacturers: ['LIXIL', 'YKK AP', '三協アルミ']");
    expect(forms).toContain("'片開き'");
    expect(forms).toContain('玄関ドアはサッシ・室内建具と分けて登録します。');
    expect(catalogSeed).toContain("entranceDoor: cid(24)");
    expect(catalogSeed).toContain("cat(C.entranceDoor, 'entrance-door', '玄関ドア'");
    expect(catalogSeed).toContain("is_required: false");
    expect(entranceDoorCategoryMigration).toContain("'entrance-door'");
    expect(entranceDoorCategoryMigration).toContain("'20000000-0000-4000-8000-000000000024'::uuid");
    expect(entranceDoorCategoryMigration).toContain("'single'");
    expect(entranceDoorCategoryMigration).toContain("'shell'");
    expect(forms).toContain("manufacturers: ['Panasonic', 'オーデリック', 'コイズミ照明', '大光電機', '東芝ライテック']");
    expect(forms).toContain("manufacturers: ['LIXIL', 'YKK AP', '美和ロック', 'GOAL', 'SwitchBot']");
    expect(forms).toContain("'窯業系サイディング'");
    expect(forms).toContain("'複合フローリング'");
    expect(forms).toContain("'ビニル壁紙'");
    expect(forms).toContain("'引違い窓'");
    expect(forms).toContain("'開き戸'");
    expect(forms).toContain("'ダウンライト'");
    expect(forms).toContain("'対応扉厚35〜55mm'");
    expect(forms).toContain('現在のサッシカテゴリーはお客様画面非表示');
  });

  it('商品特定は既存値を候補として使える', () => {
    expect(forms).toContain('option-manufacturer-suggestions');
    expect(forms).toContain('option-model-no-suggestions');
    expect(forms).toContain('カテゴリー別候補＋登録済みメーカーから選べます。候補外も直接入力できます');
    expect(forms).toContain('現在の商品マスターではシリーズ名と型番・品番を1項目で管理します');
    expect(forms).toContain('シリーズ・型番／品番');
    expect(forms).toContain('productSizeMeta');
    expect(forms).toContain('このカテゴリーの入力目安');
    expect(forms).toContain('商品管理番号');
    expect(forms).toContain('保存時に自動採番');
    expect(forms).toContain('PRD-000001形式');
    expect(forms).not.toContain('label="管理用コード"');
    expect(forms).not.toContain('id="code-all"');
    expect(adminActions).toContain('const internalCode = existingOption?.code ?? `opt-${randomUUID()}`');
    expect(adminActions).toContain('code: internalCode');
  });

  it('登録内容確認はシミュレーター共通の商品詳細を使う', () => {
    expect(editPage).toContain('OptionCustomerPreview');
    expect(editPage).toContain('実際のシミュレーターの商品詳細表示と同じ本文・レイアウト');
    expect(customerPreview).toContain("import { ProductDetail } from '@/components/simulator/product-detail'");
    expect(customerPreview).toContain('defaultVariantIdsFor');
    expect(customerPreview).toContain('pruneHiddenVariantChoices');
    expect(customerPreview).toContain('visibleVariantGroups');
    expect(customerPreview).toContain('<ProductDetail');
    expect(customerPreview).toContain('simulator-product-detail-preview');
    expect(customerPreview).toContain('商品詳細本文は実際のシミュレーターと同じコンポーネントです');
    expect(customerPreview).toContain('この確認画面では表示しません');
    expect(editPage).not.toContain('この内容に変更する（プレビュー）');
  });

  it('通常の商品登録では対象モデルと公開状態だけを前面に出す', () => {
    expect(forms).toContain('data-testid="option-normal-settings"');
    expect(forms).toContain('通常の商品登録では、対象モデルと公開状態だけ確認します。');
    expect(forms).toContain('data-testid="option-advanced-display-settings"');
    expect(forms).toContain('シミュレーター表示条件');
    expect(forms).toContain('表示順・仕様限定・標準選択などを調整する場合だけ使用します。');

    const normalStart = forms.indexOf('data-testid="option-normal-settings"');
    const advancedStart = forms.indexOf('data-testid="option-advanced-display-settings"');
    expect(normalStart).toBeGreaterThan(-1);
    expect(advancedStart).toBeGreaterThan(normalStart);
    const normalSection = forms.slice(normalStart, advancedStart);
    for (const label of ['表示順', '対応する仕様', '初期状態で選択', '必須（解除不可）', '設置関連費用として集計']) {
      expect(normalSection).not.toContain(label);
    }
  });

  it('商品情報画面にメイン画像・サブ画像・メーカーPDFをまとめる', () => {
    expect(forms).toContain('メイン画像');
    expect(media).toContain('サブ画像・メーカー資料');
    expect(media).toContain('メイン画像＋必要なサブ画像');
    expect(media).toContain('PDF内の複数ページはそのまま利用できます');
    expect(media).toContain('登録済みPDFを確認');
    expect(media).not.toContain('<details id="product-media"');
  });

  it('お客様選択は画像なし文字カードを許容し、価格設定と同じSTEP2内で管理する', () => {
    expect(variants).toContain('お客様選択');
    expect(variants).toContain('文字カードとして表示');
    expect(variants).toContain('価格・公開設定');
    expect(variants).toContain('色・仕様ごとの追加金額');
    expect(variants).toContain('ChoicePriceEditor');
    expect(variants).toContain('name="extra_price"');
  });

  it('既存の商品保存フィールドを維持する', () => {
    for (const name of [
      'name',
      'category_id',
      'base_model_id',
      'manufacturer',
      'model_no',
      'size_note',
      'highlight',
      'list_price',
      'price',
      'sort_order',
      'selection_type',
      'status',
      'description',
      'is_default',
      'is_required',
      'is_installation',
      'price_on_request',
      'image_file',
      'image_url',
      'preview_key',
      'affects_views',
      'spec_codes',
      'requires',
      'conflicts',
    ]) {
      expect(forms).toContain(`name="${name}"`);
    }
  });

  it('技術コードは登録担当者に入力させず既存値を保持する', () => {
    expect(adminActions).toContain('const existingOption = optionId ? await store.getOption(optionId) : null');
    expect(adminActions).toContain('existingOption?.code');
    expect(adminActions).toContain('opt-${randomUUID()}');
  });

  it('お客様選択の技術コードも通常入力から外して内部生成する', () => {
    expect(variants).not.toContain('label="コード"');
    expect(variants).not.toContain('name="code"');
    expect(adminActions).toContain('`vg-${randomUUID()}`');
    expect(adminActions).toContain('`vc-${randomUUID()}`');
    expect(adminActions.match(/const internalCode = existing\?\.code \?\? parsed\.data\.code;/g)).toHaveLength(2);
    expect(adminActions).toContain('code: internalCode');
  });

  it('商品価格と標準品との差額を混同しない', () => {
    expect(forms).toContain('価格・公開設定');
    expect(forms).toContain('商品価格（税別・円）');
    expect(forms).toContain('標準品との差額は別途の計算で扱います');
  });

  it('価格未確認の0円と正式な0円・別途見積を公開時に区別する', () => {
    expect(forms).toContain('価格未確認なら0円のまま下書き保存できます');
    expect(forms).toContain('単に価格が未確認なだけの場合は「別途見積」にせず');
    expect(editPage).toContain('requiresZeroPriceConfirmation(option)');
    expect(editPage).toContain('name="confirm_zero_price"');
    expect(editPage).toContain('商品価格0円が正式な登録値であることを確認しました');
    expect(adminActions).toContain("formData.get('confirm_zero_price') !== 'on'");
    expect(adminActions).toContain('introducesUnconfirmedZeroPrice(existingOption, parsed.data)');
    expect(adminActions).toContain('uploadedNewImage && image_url');
    expect(adminActions).toContain('deleteUploadedImage(image_url)');
    expect(adminActions).toContain('いったん「下書きへ戻す」で保存し、STEP 2で0円が正式価格であることを確認して再公開してください。');
  });

  it('商品一覧は検索・カテゴリー・公開状態で絞り込める', () => {
    expect(listPage).toContain('name="q"');
    expect(listPage).toContain('name="category"');
    expect(listPage).toContain('name="status"');
    expect(listPage).toContain('商品名・メーカー・型番');
  });

  it('管理画面では商品登録・編集として案内する', () => {
    expect(listPage).toContain('title="商品登録・編集"');
    expect(listPage).toContain('商品を追加');
    expect(nav).toContain("label: '商品登録・編集'");
  });
});
