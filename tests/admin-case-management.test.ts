import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
const list = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');
const newQuote = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const configurations = fs.readFileSync(path.join(root, 'app/admin/configurations/page.tsx'), 'utf8');
const contacts = fs.readFileSync(path.join(root, 'app/admin/contacts/page.tsx'), 'utf8');

describe('Admin case management UI', () => {
  it('prioritizes the HTML case-management entrances while keeping existing routes', () => {
    for (const label of ['案件一覧', '保存済み仕様', '問い合わせ受付', 'お知らせ']) {
      expect(nav).toContain(label);
    }
    expect(nav).not.toContain("label: '見積依頼・見積書'");
    expect(nav).not.toContain("label: '概要', exact: true");
    expect(nav).not.toContain("href: '/admin/quotes/new', label:");
    expect(list).toContain('＋新規案件／見積作成');
    expect(list).toContain('href="/admin/quotes/new"');
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

  it('rebuilds the case list as the dense HTML-style workspace top', () => {
    expect(list).toContain('data-testid="case-summary-strip"');
    expect(list).toContain('案件状況');
    expect(list).toContain('現在の見積金額合計');
    expect(list).toContain('契約・製造・原価・利益・災害時供給は今後対応予定');
    expect(list).toContain('案件一覧');
    for (const label of ['案件・顧客', '状態', '更新', '設置予定地', '商品モデル', '見積額', '担当代理店']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('案件名・顧客・住所・見積番号');
    expect(list).toContain('状態：すべて');
    expect(list).toContain('担当：すべて');
    expect(list).toContain('data-testid="case-list-scroll"');
    expect(list).toContain('overflow-x-auto');
    expect(list).toContain('見積番号');
    expect(list).toContain('案件を開く');
    expect(list).not.toContain('見積金額合計 0');
  });

  it('rebuilds quote detail as a case workspace with header, workflow and tabs', () => {
    expect(detail).toContain('data-testid="case-workspace-header"');
    expect(detail).toContain('data-testid="case-workflow"');
    for (const label of ['見積依頼', '担当決定', '現地確認', '正式見積', '契約', '製造', '施工', '引渡し', 'アフター']) {
      expect(detail).toContain(label);
    }
    for (const label of ['見積書', 'プランボード', '現地条件', '契約・図面・資料', '製造・施工', '引渡し・アフター', '災害時提供']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('現在DBで追跡できる範囲');
    expect(detail).toContain('今後対応予定');
    expect(detail).toContain('<QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />');
    expect(detail).toContain('<DealerRevisionForm quote={quote}');
    expect(detail).toContain('<AssignDealerForm quote={quote} dealers={dealers} />');
    expect(detail).toContain('<QuoteStatusForm quote={quote} request={request} />');
    expect(detail).toContain('金額は発行時点の確定内容です。');
    expect(detail).not.toContain('金額は発行時点のスナップショットです。');
  });

  it('does not present unsupported downstream workflow data as implemented', () => {
    expect(detail).toContain('現地調査、搬入条件、地盤条件などを案件工程として保存する機能はまだありません。');
    expect(detail).toContain('契約書・確定図面・案件資料を案件単位で保存し、版や交付状況を管理する正式機能はまだありません。');
    expect(detail).toContain('製造指示、製造個体、工程日、搬入・施工進捗を保存する正式機能はまだありません。');
    expect(detail).toContain('引渡し日、完了確認、保証、点検、アフター対応を保存する正式機能はまだありません。');
    expect(detail).toContain('現在は供給可否を判定・集計しません。');
  });

  it('keeps the existing case-related URLs and aligns their user-facing names', () => {
    for (const href of ['/admin/quotes', '/admin/configurations', '/admin/contacts', '/admin/notifications']) {
      expect(nav).toContain(`href: '${href}'`);
    }
    expect(newQuote).toContain('<BackLink href="/admin/quotes" label="案件一覧へ戻る" />');
    expect(newQuote).toContain('title="新規案件／見積作成"');
    expect(configurations).toContain('title="保存済み仕様"');
    expect(contacts).toContain('title="問い合わせ受付"');
  });
});
