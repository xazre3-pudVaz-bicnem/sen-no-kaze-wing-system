import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
const list = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');
const newQuote = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');

describe('Admin case management UI', () => {
  it('uses case-management navigation without a quote-list primary label', () => {
    for (const label of ['案件一覧', '新規見積を作成', '保存された仕様', 'お問い合わせ', 'お知らせ']) {
      expect(nav).toContain(label);
    }
    expect(nav).not.toContain("label: '見積依頼・見積書'");
    expect(nav).not.toContain("label: '概要', exact: true");
  });

  it('keeps the overview focused on case work', () => {
    expect(dashboard).toContain('title="案件管理"');
    expect(dashboard).toContain('未対応の見積依頼');
    expect(dashboard).toContain('未対応のお問い合わせ');
    expect(dashboard).toContain('最近の案件受付');
    expect(dashboard).toContain('案件を開く');
    expect(dashboard).not.toContain('findMissingPreviewCombos');
    expect(dashboard).not.toContain('公開中モデル');
    expect(dashboard).not.toContain('自社のフリー商品');
  });

  it('makes the case list customer and case-content centered while keeping quote numbers', () => {
    expect(list).toContain('title="案件一覧"');
    expect(list).toContain('title="担当案件"');
    for (const label of ['お客様・案件', '対象商品・仕様', '設置予定地', '担当代理店', '現在の状態', '見積金額', '更新・受付']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('見積番号');
    expect(list).toContain('案件を開く');
    expect(list).toContain('FINISH_LEVEL_INFO');
    expect(list).toContain('href={`/api/quotes/${q.id}/pdf`}');
    expect(list).not.toContain('>詳細<');
  });

  it('groups existing operations into case-detail sections without inventing future workflow data', () => {
    expect(detail).toContain('title="案件詳細"');
    for (const label of ['案件概要', '見積書', 'プランボード', '契約・図面・資料', '製造・施工', '引渡し・アフター']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('現在の状態');
    expect(detail).toContain('仕様');
    expect(detail).toContain('FINISH_LEVEL_INFO[quote.finish_level].name');
    expect(detail).toContain('<QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />');
    expect(detail).toContain('<DealerRevisionForm quote={quote}');
    expect(detail).toContain('<AssignDealerForm quote={quote} dealers={dealers} />');
    expect(detail).toContain('<QuoteStatusForm quote={quote} request={request} />');
    expect(detail).toContain('金額は発行時点の確定内容です。');
    expect(detail).toContain('契約書・図面・案件資料の正式な保存・管理機能は、今後の工程で対応予定です。');
    expect(detail).toContain('製造・施工の正式な進捗管理機能は、今後の工程で対応予定です。');
    expect(detail).toContain('引渡し・アフター対応の正式な管理機能は、今後の工程で対応予定です。');
    expect(detail).not.toContain('金額は発行時点のスナップショットです。');
  });

  it('keeps existing routes and returns from new quote creation to the case list', () => {
    expect(nav).toContain("href: '/admin/quotes'");
    expect(nav).toContain("href: '/admin/quotes/new'");
    expect(nav).toContain("href: '/admin/configurations'");
    expect(nav).toContain("href: '/admin/contacts'");
    expect(nav).toContain("href: '/admin/notifications'");
    expect(newQuote).toContain('<BackLink href="/admin/quotes" label="案件一覧へ戻る" />');
  });
});
