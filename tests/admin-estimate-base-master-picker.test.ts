import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/estimate-templates/new/page.tsx'),
  'utf8'
);
const newForm = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/new-estimate-template-form.tsx'),
  'utf8'
);

describe('見積書の本体選択UI', () => {
  it('公開中の本体マスター公開版と明細をread-onlyで読み込む', () => {
    expect(newPage).toContain("from('base_masters')");
    expect(newPage).toContain("from('base_master_revisions')");
    expect(newPage).toContain("from('base_master_revision_lines')");
    expect(newPage).toContain("current_published_revision_id");
    expect(newPage).toContain(".eq('status', 'published')");
    expect(newPage).toContain('lineSubtotal');
    expect(newPage).toContain('expenseAmount');
    expect(newPage).toContain('baseMasterSourceReady');
    expect(newPage).not.toContain('.insert(');
    expect(newPage).not.toContain('.update(');
    expect(newPage).not.toContain('.delete(');
  });

  it('新規作成から条件設定と明細編集を同じ画面に表示する', () => {
    expect(newForm).toContain('data-testid="new-estimate-conditions"');
    expect(newForm).toContain('本体・仕様・適用地域をここで設定し、そのまま下の明細を編集できます。');
    expect(newForm).toContain('本体が未選択です');
    expect(newForm).toContain('本体を選ぶ');
    expect(newForm).toContain('商品モデル');
    expect(newForm).toContain('防火仕様');
    expect(newForm).toContain('<EstimateTemplateWorkbench');
    expect(newForm).not.toContain('StepIndicator');
    expect(newForm).not.toContain("setStep('edit')");
    expect(newForm).not.toContain('明細編集へ進む');
  });

  it('本体の選択ポップアップで公開版の明細と金額を確認できる', () => {
    expect(newForm).toContain('aria-label="使用する本体を選択"');
    expect(newForm).toContain('公開版 v{pickerBaseMaster.revisionVersion}');
    expect(newForm).toContain('明細合計');
    expect(newForm).toContain('諸費用');
    expect(newForm).toContain('本体価格計');
    expect(newForm).toContain('工事区分');
    expect(newForm).toContain('品名');
    expect(newForm).toContain('数量');
    expect(newForm).toContain('単価');
    expect(newForm).toContain('金額');
    expect(newForm).toContain('この本体を使う');
  });

  it('選択した本体明細を同じ画面の明細編集へ渡す', () => {
    expect(newForm).toContain('baseLines={selectedBaseMaster?.lines ?? []}');
    expect(newForm).toContain('baseTotal={selectedBaseMaster?.total ?? 0}');
    expect(newForm).toContain("'本体管理元：' + selectedBaseMaster.ownerName");
    expect(newForm).toContain('本体を変更・明細確認');
    expect(newForm).not.toContain('本体Revision');
    expect(newForm).not.toContain('公開Revision');
    expect(newForm).not.toContain('案件販売調整');
  });

  it('見積条件を明細編集の上部へコンパクトに統合する', () => {
    expect(newForm).toContain('space-y-3 p-4');
    expect(newForm).toContain('xl:grid-cols-5');
    expect(newForm).toContain('h-10 min-h-10');
    expect(newForm).toContain('見積書名');
    expect(newForm).toContain('見積書作成・管理へ戻る');
    expect(newForm).not.toContain('本体・条件設定へ戻る');
  });

  it('本体変更時は既存の本体明細が置き換わることを確認する', () => {
    expect(newForm).toContain("window.confirm('本体を変更すると、現在表示中の本体明細は選択した本体の内容に置き換わります。変更しますか？')");
    expect(newForm).toContain('selectedBaseMaster.id !== baseMaster.id');
  });
});
