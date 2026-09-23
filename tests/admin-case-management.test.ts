import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
const list = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const quoteEstimateSheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const newQuote = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const configurations = fs.readFileSync(path.join(root, 'app/admin/configurations/page.tsx'), 'utf8');
const contacts = fs.readFileSync(path.join(root, 'app/admin/contacts/page.tsx'), 'utf8');
const adminActions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');

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

  it('keeps the list dense and shows the selected case workspace on the same page', () => {
    expect(list).toContain('data-testid="case-summary-strip"');
    expect(list).toContain('案件状況');
    expect(list).toContain('各案件の現在金額合計');
    expect(list).toContain('data-testid="case-summary-finance"');
    expect(list).toContain('data-testid="case-summary-disaster"');
    expect(list).not.toContain('契約・製造・原価・利益・災害時供給は今後対応予定');
    expect(list).toContain('案件を選択すると、下のワークスペースが切り替わります。');
    expect(list).toContain('max-h-[20rem] overflow-auto');
    expect(list).toContain('data-selected={selected ? \'true\' : undefined}');
    expect(list).toContain("selected ? 'bg-[#fff7df]");
    expect(list).toContain('caseSelectionHref');
    expect(list).toContain('<CaseWorkspace');
    expect(list).toContain('embedded');
    expect(list).toContain('listSearchParams={sp}');
    expect(list).toContain('顧客・住所・見積番号・商品モデル');
    expect(list).toContain('状態：すべて');
    expect(list).toContain('担当：すべて');
    expect(list).toContain('data-testid="case-list-scroll"');
    expect(list).toContain('見積番号');
    expect(list).toContain('表示 {shown.length}件 / 全{requests.length}件');
    expect(list).toContain('>選択中</span>');
    expect(list).toContain('data-testid="case-row-meta"');
    expect(list).toContain('min-w-[56rem]');
    expect(list).toContain('colSpan={7}');
    for (const label of ['棟数', '見積・契約額', '原価', '利益', '利益率', '担当組織／担当者', '災害時供給']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('未登録');
  });

  it('uses one reusable workspace for the inline list and the existing detail route', () => {
    expect(detail).toContain("import { CaseWorkspace } from '@/components/admin/case-workspace'");
    expect(detail).toContain('<CaseWorkspace');
    expect(workspace).toContain('data-testid="case-workspace"');
    expect(workspace).toContain('data-testid="case-workspace-header"');
    expect(workspace).toContain('data-testid="case-structure-summary"');
    expect(workspace).toContain('防火仕様');
    expect(workspace).toContain('caseSelectedOptionIds');
    expect(workspace).toContain("option.code === 'fire-proof'");
    expect(workspace).toContain('案件構成・申し送り');
    expect(workspace).toContain('data-testid="case-workflow"');
    expect(workspace).toContain('buildInlineTabHref');
    expect(workspace).toContain("query.set('case', quoteId)");
    expect(workspace).toContain('/admin/quotes?');
  });

  it('keeps the HTML-style workflow and tabs without inventing downstream workflow data', () => {
    for (const label of ['見積依頼', '担当決定', '現地確認', '正式見積', '契約', '製造', '施工', '引渡し', 'アフター']) {
      expect(workspace).toContain(label);
    }
    for (const label of ['見積書', 'プランボード', '現地条件', '契約・図面・資料', '製造・施工', '引渡し・アフター', '災害時提供']) {
      expect(workspace).toContain(label);
    }
    expect(workspace).toContain('今後対応予定');
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).toContain('startInEditMode={Boolean(created)}');
    expect(workspace).not.toContain('<DealerRevisionForm quote={quote}');
    expect(quoteEstimateSheet).toContain('<QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />');
    expect(quoteEstimateSheet).toContain('<DealerRevisionForm');
    expect(workspace).toContain('<AssignDealerForm quote={quote} dealers={dealers} />');
    expect(workspace).toContain('<QuoteStatusForm quote={quote} request={request} compact />');
    expect(workspace).toContain('data-testid="case-admin-controls"');
    expect(workspace).toContain('状態を変更');
    expect(workspace).toContain('正式見積書');
    expect(workspace).toContain('金額は発行時点の確定内容です。');
    expect(workspace).not.toContain('金額は発行時点のスナップショットです。');
  });

  it('returns to the inline case workspace after issuing a new quote revision', () => {
    expect(adminActions).toContain('redirect(`/admin/quotes?case=${encodeURIComponent(newId)}&tab=estimate&revised=1#case-workspace`)');
    expect(list).toContain('revised={sp.revised}');
    expect(workspace).toContain('第${quote.revision}版を発行しました');
  });

  it('does not present unsupported downstream workflow data as implemented', () => {
    expect(workspace).toContain('案件受付・現地メモ');
    expect(workspace).toContain('data-testid="case-site-condition-candidates"');
    expect(workspace).toContain('正式登録候補');
    expect(workspace).toContain('都市計画区域');
    expect(workspace).toContain('用途地域');
    expect(workspace).toContain('高度地区');
    expect(workspace).toContain('防火地域');
    expect(workspace).toContain('建蔽率');
    expect(workspace).toContain('容積率');
    expect(workspace).toContain('道路幅員');
    expect(workspace).toContain('接道・道路境界');
    expect(workspace).toContain('日影規制');
    expect(workspace).toContain('遺跡対象地域');
    expect(workspace).toContain('搬入条件');
    expect(workspace).toContain('地盤条件');
    expect(workspace).toContain('要登録・確認');
    expect(workspace).toContain('都市計画資料は参考図として扱い');
    expect(workspace).toContain("tabHref('documents')");
    expect(workspace).toContain('正式なアップロード・差替え・版管理は次工程です。');
    expect(workspace).toContain('data-testid="case-drawing-grid"');
    expect(workspace).toContain('data-testid="case-document-list"');
    expect(workspace).toContain('data-testid="case-document-notes"');
    expect(workspace).toContain('案件構成・申し送り');
    expect(workspace).toContain('受注・契約メモ');
    expect(workspace).toContain('現在の見積書PDF');
    expect(workspace).toContain('原本保管は未実装');
    expect(workspace).toContain('製造指示、製造個体、工程日、搬入・施工進捗を保存する正式機能はまだありません。');
    expect(workspace).toContain('引渡し日、完了確認、保証、点検、アフター対応を保存する正式機能はまだありません。');
    expect(workspace).toContain('現在は供給可否を判定・集計しません。');
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
