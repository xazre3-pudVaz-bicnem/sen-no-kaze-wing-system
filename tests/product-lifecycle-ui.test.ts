import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// PR #500：取扱終了の商品は新しく選ばせないが、保存済みの明細・発行済みの見積の表示からは消さない。

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('商品の取扱終了：見積・標準見積の画面', () => {
  it('見積・標準見積で商品を新しく選ぶ候補は、取扱中の商品だけにする', () => {
    for (const file of [
      'app/admin/quotes/new/page.tsx',
      'app/admin/quotes/drafts/[id]/page.tsx',
      'app/admin/quotes/[id]/edit/page.tsx',
      'app/admin/estimate-templates/[id]/page.tsx',
    ]) {
      expect(read(file), file).toContain('.filter(isQuoteSelectableProduct)');
    }
    expect(read('app/admin/estimate-templates/new/page.tsx')).toContain('isQuoteSelectableProduct(option) && categoryMap');
  });

  it('標準見積の標準状態は、保存済みの取扱終了の明細だけを「（取扱終了）」として表示・保持し、新しい行では選ばせない', () => {
    const page = read('app/admin/standard-estimates/[revisionId]/page.tsx');
    const editor = read('components/admin/standard-estimate-baseline-editor.tsx');
    expect(page).toContain("isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && savedBaselineOptionIds.has(option.id))");
    expect(page).toContain("retired: productLedgerState(option) === 'retired'");
    expect(page).toContain('canSelectNew: isQuoteSelectableProduct');
    // 選択肢の一覧（新しく選ぶ）からは外し、保存済みの行だけ選べない形で表示する
    expect(editor).toContain('candidates.filter((row) => !row.retired)');
    expect(editor).toContain('{candidate?.retired && (');
    expect(editor).toContain('<option value={candidate.id} disabled>');
    expect(editor).toContain('{candidate.name}（取扱終了）');
  });

  it('発行済みの見積の確認画面は、取扱終了の商品も表示に使う（履歴から消さない）', () => {
    const workspace = read('components/admin/case-workspace.tsx');
    const start = workspace.indexOf('const catalog = options');
    expect(start).toBeGreaterThan(0);
    const catalog = workspace.slice(start, workspace.indexOf('.map(', start));
    expect(catalog).toContain("o.status === 'published'");
    expect(catalog).not.toContain('isQuoteSelectableProduct');
  });

  it('お客様向けの商品紹介ページは、シミュレーターで新しく選べる商品だけを紹介する', () => {
    expect(read('app/(site)/products/[slug]/page.tsx')).toContain('o.category_id === c.id && isSimulatorSelectableProduct(o)');
  });
});
