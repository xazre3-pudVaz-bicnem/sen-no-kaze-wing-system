import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);
const enhancer = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-ui-enhancer.tsx'),
  'utf8'
);
const finalRefinements = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-final-refinements.tsx'),
  'utf8'
);
const variantCreateAction = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/product-registration-variants.ts'),
  'utf8'
);
const adminLayout = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/layout.tsx'),
  'utf8'
);
const registrationCss = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/product-registration-refinements.css'),
  'utf8'
);

describe('商品登録のお客様選択・価格UI', () => {
  it('お客様選択は選択肢を1つの一覧にまとめ、その中から標準を指定する', () => {
    expect(variants).not.toContain("const QUICK_GROUPS = ['カラー', '柄', 'サイズ']");
    expect(finalRefinements).toContain('＋ 選択項目を追加');
    expect(finalRefinements).toContain('選択項目名');
    expect(finalRefinements).toContain('（標準を1つ選択）');
    expect(finalRefinements).toContain('＋ 選択肢を追加');
    expect(finalRefinements).toContain('name="standard_choice_index"');
    expect(finalRefinements).toContain('name="first_choice_name"');
    expect(finalRefinements).toContain('name="additional_choice_name"');
    expect(finalRefinements).not.toContain('その他の選択肢');
    expect(finalRefinements).not.toContain('label="標準の選択肢"');
    expect(finalRefinements).toContain('メーカー資料を優先してください。');
    expect(finalRefinements).toContain('画像は任意');
    expect(finalRefinements).toContain('name={`choice_image_file_${index}`}');
    expect(finalRefinements).toContain('<SmartImage src={previewUrl}');
    expect(finalRefinements).toContain('ファイル選択');
    expect(finalRefinements).toContain('clearChoiceMedia(rowId)');
    expect(variantCreateAction).toContain('selectedChoiceImage(formData, input.choiceIndex)');
    expect(variantCreateAction).toContain('store.uploadImage({');
    expect(variantCreateAction).toContain("}, 'variant-choices')");
    expect(variantCreateAction).toContain('store.deleteUploadedImage(uploadedUrl)');
    expect(variantCreateAction).toContain("kind: 'standard' as const");
    expect(variantCreateAction).toContain("kind: 'option' as const");
    expect(variantCreateAction).toContain("getAll('additional_choice_name')");
    expect(variantCreateAction).toContain('upsertVariantGroup');
    expect(variantCreateAction).toContain('upsertVariantChoice');
  });

  it('標準ラジオを切り替えても既存保存actionへ標準と追加を正規化して渡す', () => {
    expect(finalRefinements).toContain("const [choiceNames, setChoiceNames] = useState<string[]>([''])");
    expect(finalRefinements).toContain('const [standardIndex, setStandardIndex] = useState(0)');
    expect(finalRefinements).toContain("value={choiceNames[standardIndex] ?? ''}");
    expect(finalRefinements).toContain('index === standardIndex ? null');
    expect(finalRefinements).toContain('onChange={() => setStandardIndex(index)}');
    expect(finalRefinements).toContain('key={rowId}');
    expect(finalRefinements).toContain('setChoiceRowIds((rows) => rows.filter');
    expect(variantCreateAction).toContain('index >= standardIndex ? index + 1 : index');
    expect(variantCreateAction).toContain('standardIndex < 0 || standardIndex > additionalChoiceNames.length');
  });

  it('選択肢保存では検証用option_idをDB payloadへ送らない', () => {
    expect(variantCreateAction).toContain('option_id: option.id');
    expect(variantCreateAction).not.toContain('upsertVariantChoice({ ...choice.data');
    expect(variantCreateAction).toContain('group_id: choice.group_id');
    expect(variantCreateAction).toContain('name: choice.name');
    expect(variantCreateAction).toContain('kind: choice.kind');
  });

  it('カテゴリーに応じて選択項目名と各選択肢の候補を表示し、自由入力も残す', () => {
    expect(finalRefinements).toContain('CATEGORY_SUGGESTIONS');
    expect(finalRefinements).toContain("groups: ['床', 'カウンター', 'アクセントパネル', '周辺パネル', '浴槽', '水栓']");
    expect(finalRefinements).toContain("groups: ['色', '柄', '張り方', '仕上げ']");
    expect(finalRefinements).toContain("groups: ['デザイン', '色', 'ハンドル', 'ガラス']");
    expect(finalRefinements).toContain('selectedOptions[0]?.textContent?.trim()');
    expect(finalRefinements).toContain('data-testid="inline-variant-suggestions"');
    expect(finalRefinements).toContain('values={suggestions.groups}');
    expect(finalRefinements).toContain('values={suggestions.choices}');
    expect(finalRefinements).not.toContain('候補を見る');
    expect(finalRefinements).not.toContain("onFocus={() => setActiveSuggestions('group')}");
    expect(finalRefinements).not.toContain('onFocus={() => setActiveSuggestions(index)}');
    expect(finalRefinements).toContain('候補外も自由入力できます。');
  });

  it('選択項目名は短く、各選択肢を名称と画像の2行に分けて直接入力できる', () => {
    expect(finalRefinements).toContain('const groupPlaceholder =');
    expect(finalRefinements).toContain("suggestions.groups.slice(0, 3).join('／')");
    expect(finalRefinements).toContain('data-testid="compact-variant-group-field"');
    expect(finalRefinements).toContain('sm:grid-cols-[7rem_minmax(0,26rem)]');
    expect(finalRefinements).toContain('placeholder={groupPlaceholder}');
    expect(finalRefinements).not.toContain('placeholder="例：周辺パネル"');
    expect(finalRefinements).toContain('data-testid="compact-variant-choices"');
    expect(finalRefinements).toContain('data-testid="compact-variant-footer"');
    expect(finalRefinements).toContain('name={`choice_image_file_${index}`}');
    expect(registrationCss).toContain("[data-testid='compact-variant-footer']");
    expect(registrationCss).toContain('max-width: 44rem;');
    expect(registrationCss).toContain('max-width: min(100%, 22rem);');
    expect(finalRefinements).toContain('max-w-[22rem] flex-[1_1_14rem]');
    expect(finalRefinements).toContain('max-w-[44rem] space-y-2');
    expect(finalRefinements).toContain('aria-expanded={open}');
    expect(registrationCss).not.toContain('form > div.rounded-xl.border.border-line.bg-white.p-4');
  });

  it('画像URL欄は選択肢の2行目にあり、行IDで入力状態を保持する', () => {
    expect(finalRefinements).toContain('data-testid="two-line-choice"');
    expect(finalRefinements).toContain('data-testid="choice-image-inputs"');
    expect(finalRefinements.indexOf('data-testid="choice-image-inputs"')).toBeGreaterThan(
      finalRefinements.indexOf('name="standard_choice_index"')
    );
    expect(finalRefinements).toContain('name={`choice_image_url_${index}`}');
    expect(finalRefinements).toContain('name={`choice_image_file_${index}`}');
    expect(finalRefinements).toContain('onChange={(event) => onChoiceImageUrlChange(rowId, event.target.value)}');
    expect(finalRefinements).toContain('const [choiceImageUrls, setChoiceImageUrls] = useState<Record<number, string>>({})');
    expect(finalRefinements).toContain('const imageUrl = choiceImageUrls[rowId]');
    expect(finalRefinements).toContain("setChoiceImageUrls((urls) => ({ ...urls, [rowId]: '' }))");
    expect(finalRefinements).toContain('clearChoiceMedia(rowId)');
    expect(finalRefinements).toContain('<SmartImage src={previewUrl}');
  });

  it('画像URLへの切り替えとファイルへの切り替えで他方の指定を解除する', () => {
    expect(finalRefinements).toContain('const onChoiceImageUrlChange = (rowId: number, value: string) => {');
    expect(finalRefinements).toContain('if (value.trim()) clearChoiceImage(rowId);');
    expect(finalRefinements).toContain("setChoiceImageUrls((urls) => ({ ...urls, [rowId]: '' }))");
    expect(finalRefinements).toContain('const clearChoiceMedia = (rowId: number) => {');
    expect(finalRefinements).toContain('delete next[rowId];');
    expect(finalRefinements).toContain('clearChoiceMedia(choiceRowIds[index])');
  });

  it('URLも元の行番号で保存し、不正URLとファイル同時指定を拒否する', () => {
    expect(variantCreateAction).toContain('function selectedChoiceImageUrl(formData: FormData, choiceIndex: number)');
    expect(variantCreateAction).toContain('index >= standardIndex ? index + 1 : index');
    expect(variantCreateAction).toContain('const imageUrl = selectedChoiceImageUrl(formData, input.choiceIndex)');
    expect(variantCreateAction).toContain('if (file && imageUrl)');
    expect(variantCreateAction).toContain('imageUrl && !isAllowedChoiceImageUrl(imageUrl)');
    expect(variantCreateAction).toContain("url.protocol === 'https:'");
    expect(variantCreateAction).toContain('image_url: selectedChoiceImageUrl(formData, input.choiceIndex) || null');
    expect(variantCreateAction).toContain('image_url: uploadedUrl ?? choice.image_url');
    expect(variantCreateAction).toContain('row.name && (');
  });

  it('メイン画像と追加画像の実際の余白を測り、同じカードに見える位置まで詰める', () => {
    expect(finalRefinements).toContain("'.registration-step1-sections #product-main-media'");
    expect(finalRefinements).toContain("'.registration-step1-sections #product-sub-images'");
    expect(finalRefinements).toContain('extra.getBoundingClientRect().top - main.getBoundingClientRect().bottom');
    expect(finalRefinements).toContain('currentMargin - gap');
    expect(finalRefinements).toContain("main.style.borderBottomWidth = '0px'");
  });

  it('STEP1の価格欄では対象モデルと公開状態を前面に出さず、価格だけを表示する', () => {
    expect(adminLayout).toContain("import './product-registration-refinements.css';");
    expect(adminLayout).toContain('ProductRegistrationFinalRefinements');
    expect(registrationCss).toContain("content: '6. 価格' !important;");
    expect(registrationCss).toContain("content: '商品価格を設定します。公開はSTEP 2で行います。';");
    expect(registrationCss).toContain("#sales-settings [data-testid='option-normal-settings']");
    expect(registrationCss).toContain('display: none !important;');
    expect(enhancer).toContain('0円のまま下書き保存できます。公開時に0円でよいか確認します。');
  });

  it('DOM補助処理自身の変更でMutationObserverが再帰し続けない', () => {
    expect(enhancer).toContain('function setTextIfChanged');
    expect(enhancer).toContain("if (element.textContent !== value) element.textContent = value");
    expect(enhancer).toContain('observer.disconnect();\n      enhance();\n      observer.observe(document.body, { childList: true, subtree: true });');
  });
});
