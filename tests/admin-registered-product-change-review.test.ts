import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'), 'utf8');
const newPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'), 'utf8');
const flow = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/registered-option-edit-flow.tsx'), 'utf8');
const variantHeading = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-variant-group-heading.tsx'), 'utf8');
const identityView = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-identity-status.tsx'), 'utf8');

describe('登録済み商品の変更確認フロー', () => {
  it('新規登録STEP1と同じ順序で基本情報・詳細・画像・資料・価格・確認を並べる', () => {
    const sectionIds = [
      'registered-product-identify',
      'registered-product-details',
      'registered-product-main-media',
      'registered-option-pending-subedit',
      'registered-option-current-choices',
      'registered-product-pricing',
      'registered-product-change-check',
    ];
    const indices = sectionIds.map((id) => flow.indexOf(`data-testid="${id}"`));
    expect(indices.every((position) => position >= 0)).toBe(true);
    expect(indices.every((position, index) => index === 0 || position > indices[index - 1])).toBe(true);
    for (const heading of [
      '1. 基本情報', '2. 商品の詳細', '3. 商品画像',
      '4. メーカー資料', '5. お客様選択',
      '6. 価格・対象モデル', '7. 変更内容の確認',
    ]) {
      expect(flow).toContain(heading);
    }
    expect(flow).toContain('name="status" value="published"');
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
    expect(flow).toContain('registered-option-pending-subedit');
  });

  it('登録済み商品を初回登録のSTEPフローから分離する', () => {
    expect(page).toContain("if (option.status === 'published')");
    expect(page).toContain('<RegisteredOptionEditFlow');
    expect(page.indexOf("if (option.status === 'published')")).toBeLessThan(page.indexOf('<OptionRegistrationSaveBoundary>'));
    expect(flow).toContain('商品を編集');
    expect(flow).toContain('変更内容確認');
    expect(flow).not.toContain('商品登録の流れ');
    expect(flow).toContain('name="status" value="published"');
    expect(flow).not.toContain('<option value="draft">');
    expect(flow).not.toContain('変更内容を自動保存しました。');
  });

  it('価格単位・本部基準原価を6の後、確認の前に置き、独立保存を維持する', () => {
    const priceStart = flow.indexOf('data-testid="registered-product-pricing"');
    const formClose = flow.indexOf('</form>', priceStart);
    const toolsStart = flow.indexOf('data-testid="registered-product-financial-tools"');
    const reviewStart = flow.indexOf('data-testid="registered-product-change-check"');
    expect(priceStart).toBeGreaterThan(-1);
    expect(formClose).toBeGreaterThan(priceStart);
    expect(toolsStart).toBeGreaterThan(formClose);
    expect(reviewStart).toBeGreaterThan(toolsStart);
    expect(flow).toContain('id="registered-option-main-edit-form"');
    expect(flow).toContain('form="registered-option-main-edit-form"');
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
    expect(flow).toContain('商品価格の「変更内容を確認」では保存されません');
    expect(page).toContain('financialTools={');
    const editableBranch = page.slice(page.indexOf('if (option.status === \'published\')'), page.indexOf('const stepHref'));
    const editorProps = editableBranch.slice(editableBranch.indexOf('<RegisteredOptionEditFlow'), editableBranch.indexOf(') : ('));
    expect(editorProps).toContain('<ProductPriceUnitPublishedCard');
    expect(editorProps).toContain('<OptionHqStandardCostCard');
    expect(editorProps).toContain('duplicateCandidates={catalogEditor ?');
    expect(editorProps).not.toContain('allOptions={options}');
    expect(editableBranch).toContain('この商品は閲覧専用です');
  });

  it('重複チェックは登録内容を表示し、編集後は未確認として扱う', () => {
    expect(flow).toContain('testId="registered-option-duplicate-status"');
    expect(flow).toContain('duplicateCandidates &&');
    expect(flow).toContain('<ProductDuplicateStatus');
    expect(flow).toContain("const [identityChanged, setIdentityChanged] = useState(false)");
    expect(flow).toContain('setIdentityChanged(true)');
    expect(identityView).toContain('入力変更後の重複は未確認');
    expect(flow).toContain('変更前の登録内容に対する確認結果です');
    expect(identityView).toContain("candidate.reason === 'manufacturer-model'");
    expect(identityView).toContain('candidate.productNo');
    expect(flow).toContain('同じ商品を重複登録していないか確認してください');
  });

  it('確認前はブラウザ内のFormDataだけに保持し、反映ボタンで既存保存Actionを呼ぶ', () => {
    expect(flow).toContain("const data = new FormData(form)");
    expect(flow).toContain("setScreen('review')");
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
    expect(flow).toContain('この変更を反映');
    expect(flow).toContain('「この変更を反映」を押すまで、登録済みの商品情報には反映されません。');
    expect(flow).toContain('name="status" value="published"');
  });

  it('変更項目だけを変更前・変更後で比較し、長文と画像は現在内容との比較にする', () => {
    expect(flow).toContain("row.before !== row.after");
    expect(flow).toContain('変更前');
    expect(flow).toContain('変更後');
    expect(flow).toContain('現在の内容');
    expect(flow).toContain('変更後の内容');
    expect(flow).toContain("kind: 'long'");
    expect(flow).toContain("kind: 'image'");
    expect(flow).toContain('メイン画像');
    expect(flow).toContain('商品説明');
    expect(flow).toContain('h-32 items-center');
    expect(flow).toContain('sm:h-36');
  });

  it('下書きと同じ2ステップ案内、商品管理番号、メイン画像プレビューを表示する', () => {
    expect(flow).toContain('data-testid="registered-option-change-steps"');
    expect(flow).toContain('商品変更の流れ');
    expect(flow).toContain('STEP 1 商品情報を編集');
    expect(flow).toContain('STEP 2');
    expect(flow).toContain('aria-current={screen === \'edit\'');
    expect(flow).toContain('aria-current={screen === \'review\'');
    expect(flow).toContain('testId="registered-option-product-number"');
    expect(flow).toContain('<ProductManagementNumber');
    expect(flow).toContain('option.product_no');
    expect(flow).toContain('data-testid="registered-option-main-image-preview"');
    expect(flow).toContain('src={mainImagePreview}');
    expect(flow).toContain('value={imageUrlInput}');
    expect(flow).toContain('updateImageFilePreview(event.target.files?.[0] ?? null)');
    expect(flow).toContain('const mainImagePreview = selectedImagePreview ??');
    expect(flow).toContain('fileToDataUrl(file)');
    expect(flow).toContain('imagePreviewRequest.current === request');
    expect(identityView).toContain('登録後は変更しません');
    expect(flow).toContain('画像を選んだだけでは保存されません');
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
  });

  it('変更後のお客様表示プレビューと編集への戻り導線を持ち、戻っても入力フォームを破棄しない', () => {
    expect(flow).toContain('変更後のお客様表示プレビュー');
    expect(flow).toContain('<OptionCustomerPreview');
    expect(flow).toContain('option={review.option}');
    expect(flow).toContain('実際のお客様画面と同じ内容で表示しています。');
    expect(flow).toContain('[&>div>p:last-child]:hidden');
    expect(flow).toContain('編集に戻る');
    expect(flow).toContain("hidden={screen !== 'review'}");
    expect(flow).toContain("hidden={screen !== 'edit'}");
    expect(flow).not.toContain("if (screen === 'review' && review)");
  });

  it('入力・参照項目は折り畳まず常に表示し、余白だけコンパクトにする', () => {
    const start = flow.indexOf('data-testid="registered-option-edit-flow"');
    const end = flow.indexOf('</form>', start);
    const edit = flow.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(edit).not.toContain('<details');
    expect(edit).not.toContain('<summary');
    expect(edit).toContain('className="space-y-4" noValidate');
    expect(edit).toContain('className="grid gap-4 sm:grid-cols-2"');
    expect(edit).toContain('data-testid="registered-option-pending-subedit"');
    expect(edit).toContain('data-testid="registered-option-current-choices"');
    expect(edit).toContain('data-testid="registered-product-display-settings"');
    expect(edit).toContain('name="spec_codes"');
    expect(edit).toContain('name="is_required"');
    expect(edit).toContain('name="price"');
    expect(edit).toContain('name="status" value="published"');
  });

  it('追加画像を画像欄にまとめ、PDFとお客様選択は参照専用を維持する', () => {
    const imageSection = flow.indexOf('data-testid="registered-product-main-media"');
    const gallerySection = flow.indexOf('data-testid="registered-option-current-gallery"');
    const pdfSection = flow.indexOf('data-testid="registered-option-pending-subedit"');
    const choicesSection = flow.indexOf('data-testid="registered-option-current-choices"');
    const priceSection = flow.indexOf('data-testid="registered-product-pricing"');
    expect(gallerySection).toBeGreaterThan(imageSection);
    expect(pdfSection).toBeGreaterThan(gallerySection);
    expect(choicesSection).toBeGreaterThan(pdfSection);
    expect(priceSection).toBeGreaterThan(choicesSection);
    const gallery = flow.slice(gallerySection, pdfSection);
    const readOnly = flow.slice(pdfSection, priceSection);
    expect(gallery).toContain('galleryImages.map(');
    expect(gallery).not.toContain('<Button');
    expect(gallery).not.toContain('<Input');
    expect(gallery).not.toContain('<form');
    expect(readOnly).toContain('option.manufacturer_document_url');
    expect(readOnly).toContain('orderedVariantGroups.map(');
    expect(readOnly).toContain('orderedVariantChoices.filter(');
    expect(readOnly).toContain('VARIANT_KIND_LABELS[choice.kind]');
    expect(readOnly).toContain("choice.price_on_request ? '別途見積'");
    expect(readOnly).toContain('<ProductVariantGroupHeading group={group} choiceCount={choices.length} headingLevel="h4" />');
    expect(variantHeading).toContain("group.status === 'published'");
    expect(readOnly).toContain("choice.status === 'draft'");
    expect(readOnly).toContain('rel="noopener noreferrer"');
    expect(readOnly).not.toContain('<form');
    expect(readOnly).not.toContain('<Input');
    expect(readOnly).not.toContain('<Button');
    expect(readOnly).not.toContain('<Checkbox');
    expect(readOnly).not.toContain('name=');
    expect(flow).toContain('saveOptionAction(initialState, review.formData)');
  });

  it('別保存の資料・お客様選択は仮実装せず接続待ちにする', () => {
    expect(flow).toContain('registered-option-pending-subedit');
    expect(flow).toContain('サブ画像・メーカーPDF・お客様が選ぶ仕様');
    expect(flow).toContain('変更確認フローへの接続待ち');
    expect(flow).not.toContain('OptionMediaManager');
    expect(flow).not.toContain('OptionVariantManager');
  });

  it('登録済み商品の通常価格0円への変更は既存サーバールール接続待ちとして反映を止める', () => {
    expect(flow).toContain('introducesUnconfirmedZeroPrice');
    expect(flow).toContain('zeroPriceNeedsServerContract');
    expect(flow).toContain('現在のサーバー側ルールとの接続待ち');
  });

  it('初回登録はSTEP1→STEP2→この内容で登録を維持する', () => {
    expect(page).toContain('STEP 1 商品情報');
    expect(page).toContain('STEP 2 登録内容確認');
    expect(page).toContain('この内容で登録');
    expect(newPage).toContain('商品登録の2ステップ');
    expect(newPage).toContain('この内容で登録');
  });
});