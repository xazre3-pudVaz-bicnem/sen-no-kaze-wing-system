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

  it('使用する本体を先に選び商品モデルと防火仕様を自動表示する', () => {
    expect(newForm).toContain('先に使用する本体を選びます。商品モデルと防火仕様は、選んだ本体マスターから自動設定されます。');
    expect(newForm).toContain('本体を選ぶ');
    expect(newForm).toContain('商品モデル');
    expect(newForm).toContain('防火仕様');
    expect(newForm).toContain("selectedBaseMaster?.modelId");
    expect(newForm).toContain("fireLabel(selectedBaseMaster.fireSpec)");
    expect(newForm).toContain('本体・条件設定');
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

  it('選択した本体明細を明細編集の本体欄へ渡す', () => {
    expect(newForm).toContain('baseLines={selectedBaseMaster?.lines ?? []}');
    expect(newForm).toContain('baseTotal={selectedBaseMaster?.total ?? 0}');
    expect(newForm).toContain('本体管理元：');
    expect(newForm).toContain("selectedBaseMaster.name + (samplePreview ? '' : ' ／ 公開版 v' + selectedBaseMaster.revisionVersion)");
    expect(newForm).not.toContain('本体Revision');
    expect(newForm).not.toContain('公開Revision');
    expect(newForm).not.toContain('案件販売調整');
  });

  it('本体・条件設定画面を縦方向にコンパクト化する', () => {
    expect(newForm).toContain('space-y-4 p-4 sm:p-5');
    expect(newForm).toContain('px-4 py-3');
    expect(newForm).toContain('md:grid-cols-4');
    expect(newForm).toContain('h-10 min-h-10');
    expect(newForm).not.toContain('space-y-6 p-5 sm:p-6');
  });
});
