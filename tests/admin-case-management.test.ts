import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dashboard = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
const list = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');

describe('Admin case management UI', () => {
  it('keeps the overview focused on case work', () => {
    expect(dashboard).toContain('title="案件管理"');
    expect(dashboard).toContain('未対応の見積依頼');
    expect(dashboard).toContain('未対応のお問い合わせ');
    expect(dashboard).not.toContain('findMissingPreviewCombos');
    expect(dashboard).not.toContain('公開中モデル');
    expect(dashboard).not.toContain('自社のフリー商品');
  });

  it('uses role-specific case list names without changing the routes', () => {
    expect(list).toContain('title="案件一覧"');
    expect(list).toContain('title="担当案件"');
    expect(list).toContain('href={`/admin/quotes/${q.id}`}');
    expect(list).toContain('href={`/api/quotes/${q.id}/pdf`}');
  });

  it('groups the existing quote operations into case-detail sections', () => {
    for (const label of ['案件概要', '見積書', 'プランボード', '契約・図面・資料', '製造・施工', '引渡し・アフター']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('<QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />');
    expect(detail).toContain('<DealerRevisionForm quote={quote}');
    expect(detail).toContain('<AssignDealerForm quote={quote} dealers={dealers} />');
    expect(detail).toContain('<QuoteStatusForm quote={quote} request={request} />');
    expect(detail).toContain('金額は発行時点の確定内容です。');
    expect(detail).not.toContain('金額は発行時点のスナップショットです。');
  });
});
