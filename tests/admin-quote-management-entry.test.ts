import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/quote-management/page.tsx'), 'utf8');
const review = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/case-estimate-review.tsx'), 'utf8');
const tabs = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/quote-management-tabs.tsx'), 'utf8');
const nav = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'), 'utf8');

describe('見積書管理の案件見積入口', () => {
  it('見積書管理の初期画面を案件見積一覧と確認詳細にする', () => {
    expect(nav).toContain("href: '/admin/quote-management'");
    expect(tabs).toContain('href="/admin/quote-management"');
    expect(page).toContain('案件見積一覧');
    expect(page).toContain('<CaseEstimateReview');
    expect(page).toContain('案件管理を開く');
    expect(page).not.toContain('＋ 新しい案件見積');
  });

  it('Draftと正式見積を一覧選択し同じページ下部で確認する', () => {
    expect(page).toContain('store.listInitialQuoteDraftResumes(actor)');
    expect(page).toContain('store.listAllQuotes()');
    expect(page).toContain("selection: { kind: 'draft', id: draft.draft_id }");
    expect(page).toContain("selection: { kind: 'quote', id: quote.id }");
    expect(page).toContain("params.set(row.selection.kind, row.selection.id)");
    expect(page).toContain('#case-estimate-review');
    expect(page).toContain('aria-selected={selected}');
    expect(page).toContain("{selected ? '表示中' : '確認'}");
    expect(page).not.toContain('/admin/quotes/drafts/');
  });

  it('検索機能と一覧の主要列を維持する', () => {
    expect(page).toContain('案件名・顧客名・会社名・見積番号・商品モデルで検索');
    for (const label of ['案件・顧客', '見積番号', '商品モデル', '状態', '金額', '更新', '選択']) {
      expect(page).toContain(label);
    }
    expect(page).toContain('min-w-[62rem]');
    expect(page).toContain('lg:min-w-0');
  });

  it('確認詳細は見積書・プランボード・図面の3タブに限定する', () => {
    expect(review).toContain("type ReviewTab = 'estimate' | 'plan' | 'drawing'");
    expect(review).toContain("{ key: 'estimate', label: '見積書' }");
    expect(review).toContain("{ key: 'plan', label: 'プランボード' }");
    expect(review).toContain("{ key: 'drawing', label: '図面' }");
    expect(review).toContain('aria-label="案件見積の確認内容"');
  });

  it('発行済み見積は既存の明細表示とPDFを確認専用で再利用する', () => {
    expect(review).toContain('<QuoteEstimateSheet');
    expect(review).toContain('canEditBase={false}');
    expect(review).toContain('canRevise={false}');
    expect(review).toContain('/api/quotes/${quote.id}/pdf');
    expect(review).toContain('発行済み見積は確認専用です');
    expect(review).not.toContain('PDF再生成');
  });

  it('Draftは保存済み値を読み取り表示し編集導線は案件管理へ送る', () => {
    expect(review).toContain('store.getQuoteDraft(selection.id, actor)');
    expect(review).toContain('<DraftItemTable items={items} />');
    expect(review).toContain('{formatYen(draft.total)}');
    expect(review).toContain('未発行のためなし');
    expect(review).toContain('/admin/quotes?request=${encodeURIComponent(draft.quote_request_id)}#pending-quote-request');
    expect(review).not.toContain('/admin/quotes/drafts/');
  });

  it('プランを発行時点Snapshotとして偽装しない', () => {
    expect(review).toContain('プランボードは現在準備中です');
    expect(review).toContain('Quote Revisionに発行時点の平面図・完成イメージを固定する契約を現在確認できないため');
    expect(review).not.toContain('<CasePlanBoard');
    expect(review).not.toContain('store.getCasePlanConfiguration');
  });

  it('図面は登録済み資料だけを参照し発行時点固定とは表示しない', () => {
    expect(review).toContain('store.listCaseDocuments(quote.id, actor)');
    expect(review).toContain("document.kind === 'floorplan' || document.kind === 'elevation' || document.kind === 'other'");
    expect(review).toContain('発行時点に使用した正式図面versionとして固定されていることまでは保証しない');
    expect(review).toContain('安全に紐づけて表示できる平面図・立面図・その他図面は現在ありません。');
  });

  it('独立した見積編集機能を持たず案件管理を正式入口にする', () => {
    expect(review).toContain('案件管理で開く');
    expect(review).toContain('/admin/quotes?case=${encodeURIComponent(quote.id)}&tab=estimate#case-workspace');
    expect(review).toContain('/admin/quotes?request=${encodeURIComponent(draft.quote_request_id)}#pending-quote-request');
    expect(review).not.toContain('見積を編集');
    expect(page).not.toContain('/admin/quotes/drafts/');
  });

  it('シミュレーター標準は別タブのまま維持する', () => {
    expect(tabs).toContain('href="/admin/estimate-templates"');
    expect(tabs).toContain('シミュレーター標準');
  });
});
