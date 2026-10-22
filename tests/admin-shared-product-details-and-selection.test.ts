import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const sharedDetails = read('components/admin/product-details-fields.tsx');
const draft = read('components/admin/forms.tsx');
const published = read('components/admin/registered-option-edit-flow.tsx');
const sharedHeading = read('components/admin/product-variant-group-heading.tsx');
const draftChoices = read('components/admin/option-variant-manager.tsx');

describe('下書き／登録済みの商品詳細・お客様選択のUI共通化', () => {
  it('特徴・商品説明は同一の入力部品を使い、サイズは各画面から安全に渡す', () => {
    expect(sharedDetails).toContain('export function ProductDetailsFields');
    expect(sharedDetails).toContain('sizeField: ReactNode');
    expect(sharedDetails).toContain('name="description"');
    expect(sharedDetails).toContain('<ProductHighlightTextarea');
    expect(draft).toContain('<ProductDetailsFields');
    expect(published).toContain('<ProductDetailsFields');
    expect(draft).toContain('list="option-size-note-suggestions"');
    expect(draft).toContain('sizeSuggestions.map(');
    expect(draft).toContain('markOptionDirty()');
    expect(published).toContain('id="registered-size-note"');
    expect(published).toContain('name="size_note"');
    expect(published).toContain('value={sizeNoteValue}');
    expect(published).toContain('highlightId="registered-highlight"');
    expect(published).toContain('descriptionId="registered-description"');
  });

  it('選択項目見出しは件数・公開状態・必須を共通の表示部品にする', () => {
    expect(sharedHeading).toContain('export function ProductVariantGroupHeading');
    expect(sharedHeading).toContain('group.name');
    expect(sharedHeading).toContain('choiceCount}選択肢');
    expect(sharedHeading).toContain("group.status === 'published'");
    expect(sharedHeading).toContain('group.is_required');
    expect(sharedHeading).toContain('group.depends_on_group_code');
    expect(draftChoices).toContain('<ProductVariantGroupHeading group={group} choiceCount={groupChoices.length} />');
    expect(published).toContain('<ProductVariantGroupHeading group={group} choiceCount={choices.length} headingLevel="h4" />');
  });

  it('共通部品は表示のみで下書きや登録済み商品の保存処理を変更しない', () => {
    for (const source of [sharedDetails, sharedHeading]) {
      expect(source).not.toContain('saveOptionAction');
      expect(source).not.toContain('saveVariantGroupAction');
      expect(source).not.toContain('saveVariantChoiceAction');
      expect(source).not.toContain('useActionState');
      expect(source).not.toContain('<form');
    }
    expect(draft).toContain('useOptionRegistrationSave()');
    expect(draftChoices).toContain('saveVariantChoiceAction');
    expect(draftChoices).toContain('saveVariantGroupAction');
    expect(published).toContain('saveOptionAction(initialState, review.formData)');
    expect(published).not.toContain('saveVariantChoiceAction');
    expect(published).not.toContain('saveVariantGroupAction');
  });

  it('編集画面の項目は折り畳まない', () => {
    expect(draft).toContain('<ProductDetailsFields');
    expect(published).toContain('data-testid="registered-product-details"');
    expect(published).toContain('data-testid="registered-option-current-choices"');
    const choicesStart = published.indexOf('data-testid="registered-option-current-choices"');
    const choicesEnd = published.indexOf('data-testid="registered-product-pricing"', choicesStart);
    const choicesBlock = published.slice(choicesStart, choicesEnd);
    expect(choicesBlock).not.toContain('<details');
    expect(choicesBlock).not.toContain('name="extra_price"');
    expect(choicesBlock).not.toContain('<form');
  });
});
