import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nav = fs.readFileSync(path.join(root, 'components/admin/admin-nav.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'components/admin/admin-shell.tsx'), 'utf8');
const adminLayout = fs.readFileSync(path.join(root, 'app/admin/layout.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
const list = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');
const quoteEstimateSheet = fs.readFileSync(path.join(root, 'components/admin/quote-estimate-sheet.tsx'), 'utf8');
const casePlanBoard = fs.readFileSync(path.join(root, 'components/admin/case-plan-board.tsx'), 'utf8');
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
    expect(list).not.toContain('max-h-[20rem] overflow-auto');
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
    expect(list).not.toContain('min-w-[56rem]');
    expect(list).toContain('colSpan={6}');
    for (const label of ['棟数', '見積額', '原価', '利益', '利益率', '担当組織／担当者', '災害時供給']) {
      expect(list).toContain(label);
    }
    expect(list).toContain('未登録');
    expect(list).toContain('更新 {formatDate(updatedAt, true)}');
    expect(list).not.toContain('>更新</th>');
  });

  it('uses the 千の風プロジェクト name in the admin shell and browser title', () => {
    expect(shell).toContain('千の風プロジェクト');
    expect(shell).not.toContain('>Wing</span>');
    expect(adminLayout).toContain("千の風プロジェクト 管理画面");
    expect(adminLayout).not.toContain('Wing 管理画面');
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
    expect(workspace).toContain('data-testid="case-workflow-summary"');
    expect(workspace).toContain('md:grid-cols-9');
    expect(workspace).toContain('md:block');
    expect(workspace).toContain('案件設定');
    expect(workspace).toContain('現在フェーズ：{currentPhaseLabel}');
    expect(workspace).toContain("quote.status === 'accepted' ? '契約確認' : '正式見積'");
    expect(workspace).toContain("casePlanConfiguration?.configuration.name?.trim() || customerCompany || customerName");
    expect(workspace).toContain('契約条件の確認');
    expect(workspace).toContain("value: quote.status === 'accepted' ? '正式状態未登録' : '未対応'");
    expect(workspace).toContain('未集計');
    expect(workspace).toContain("caseStructureNote ?? '未登録'");
    expect(workspace).toContain('extractCaseUnitCount');
    expect(workspace).toContain('<b className="text-white">棟数</b> {caseUnitCount ?? \'未登録\'}');
    expect(workspace).toContain("activeTab === 'documents' || activeTab === 'site' || activeTab === 'plan'");
    expect(workspace).toContain("row.kind === 'floorplan'");
    expect(workspace).toContain("row.kind === 'elevation'");
    expect(workspace).toContain('caseFloorplan={');
    expect(casePlanBoard).toContain('caseFloorplan?: { url: string; title: string } | null');
    expect(casePlanBoard).toContain("const planDisplayName = caseFloorplan ? '案件図面'");
    expect(casePlanBoard).toContain('plan={displayedFloorplan}');
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
    expect(workspace).toContain('参考表示');
    expect(workspace).toContain('未判定');
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).toContain('startInEditMode={Boolean(created)}');
    expect(workspace).not.toContain('<DealerRevisionForm quote={quote}');
    expect(quoteEstimateSheet).toContain('showSelectedImages={false}');
    expect(quoteEstimateSheet).toContain('<DealerRevisionForm');
    expect(workspace).toContain('<AssignDealerForm quote={quote} dealers={dealers} />');
    expect(workspace).toContain('<QuoteStatusForm quote={quote} request={request} compact />');
    expect(workspace).toContain('data-testid="case-admin-controls"');
    expect(workspace).toContain('状態を変更');
    expect(workspace).toContain('正式見積書');
    expect(workspace).toContain('見積番号 {quote.quote_no}／発行');
    expect(workspace).toContain('data-testid="admin-pdf-link"');
    expect(workspace).toContain('PDF再生成');
    expect(workspace).not.toContain('この見積のPDF・画像');
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
    expect(workspace).toContain('data-testid="case-tab-site"');
    expect(workspace).toContain('data-testid="case-site-condition-candidates"');
    expect(workspace).toContain('保存済み住所・案件受付メモ・案件資料から、正式確認前の候補情報を表示します。');
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
    expect(workspace).toContain('正式な契約保存・アップロード・版管理は次工程です。');
    expect(workspace).toContain('data-testid="case-drawing-grid"');
    expect(workspace).toContain('data-testid="case-document-list"');
    expect(workspace).toContain('data-testid="case-document-notes"');
    expect(workspace).toContain('案件構成・申し送り');
    expect(workspace).toContain('受注・契約メモ');
    expect(workspace).toContain('現在の見積書PDF');
    expect(workspace).toContain('原本保管は未実装');
    expect(workspace).toContain('製造開始日、製造完了日、製造個体番号、搬入予定日、施工予定日、担当組織・担当者、各工程の進捗を保存する正式機能はまだありません。');
    expect(workspace).toContain('保証開始日・保証期限、点検予定・点検履歴、不具合・修理・問い合わせなどのアフター対応履歴を保存する正式機能はまだありません。');
    expect(workspace).toContain('現在は提供可否・供給可能棟数を判定しません。');
  });

  it('shows disaster-supply prerequisites without inventing availability', () => {
    expect(workspace).toContain('data-testid="case-tab-disaster"');
    expect(workspace).toContain('data-testid="case-disaster-reference"');
    expect(workspace).toContain('提供検討の前提');
    expect(workspace).toContain('完成個体の在庫情報や現在地ではありません。');
    expect(workspace).toContain('供給可能棟数ではありません');
    expect(workspace).toContain('完成個体の現在地ではありません');
    expect(workspace).toContain('提供意思は未登録');
    expect(workspace).toContain('data-testid="case-disaster-readiness"');
    expect(workspace).toContain('未登録を「提供不可」とは扱いません。');
    expect(workspace).toContain("['災害時の提供意思', '正式保存先なし']");
    expect(workspace).toContain("['完成個体', '正式保存先なし']");
    expect(workspace).toContain("['現在地', '正式保存先なし']");
    expect(workspace).toContain("['移動・運搬可否', '正式保存先なし']");
    expect(workspace).toContain("['即時提供可否', '正式保存先なし']");
    expect(workspace).toContain("['供給可能棟数', '正式保存先なし']");
    expect(workspace).toContain('data-testid="case-disaster-future"');
    expect(workspace).toContain('現在の案件棟数や設置予定地だけから「供給可能」と判定しません。');
  });

  it('shows handover prerequisites without inventing completion or aftercare records', () => {
    expect(workspace).toContain('data-testid="case-tab-handover"');
    expect(workspace).toContain('data-testid="case-handover-reference"');
    expect(workspace).toContain('引渡し対象の前提');
    expect(workspace).toContain('既存データからの参考表示');
    expect(workspace).toContain('引渡し確定情報ではありません。');
    expect(workspace).toContain('第{quote.revision}版／引渡し用には未固定');
    expect(workspace).toContain('data-testid="case-handover-readiness"');
    expect(workspace).toContain('現在は保存先がないため、未登録を「未完了」とは判定しません。');
    expect(workspace).toContain("['完了確認', '正式保存先なし']");
    expect(workspace).toContain("['引渡し日', '正式保存先なし']");
    expect(workspace).toContain("['引渡し確認', '正式保存先なし']");
    expect(workspace).toContain("['引渡し資料', '正式保存先なし']");
    expect(workspace).toContain('data-testid="case-aftercare-future"');
    expect(workspace).toContain('現在の見積承諾や案件メモを、引渡し済み・保証中・点検済みとは扱いません。');
  });

  it('shows production and installation scope only from existing quote data', () => {
    expect(workspace).toContain("items");
    expect(workspace).toContain("item.kind === 'installation'");
    expect(workspace).toContain('data-testid="case-tab-production"');
    expect(workspace).toContain('data-testid="case-production-reference"');
    expect(workspace).toContain('製造前提');
    expect(workspace).toContain('既存データからの参考表示');
    expect(workspace).toContain('製造指示書や製造確定仕様ではありません。');
    expect(workspace).toContain('第{quote.revision}版／製造用には未固定');
    expect(workspace).toContain('data-testid="case-installation-scope"');
    expect(workspace).toContain('見積に含まれる施工・搬入範囲');
    expect(workspace).toContain('実施済み・発注済みを意味しません。');
    expect(workspace).toContain('installationItems.map');
    expect(workspace).toContain('data-testid="case-production-future"');
    expect(workspace).toContain('見積に項目があることを、製造済み・搬入済み・施工済みとは扱いません。');
  });

  it('shows contract information only as reference data until a formal contract model exists', () => {
    expect(workspace).toContain('extractContractReference');
    expect(workspace).toContain('data-testid="case-contract-reference"');
    expect(workspace).toContain('契約情報');
    expect(workspace).toContain('正式保存前');
    expect(workspace).toContain('既存データからの参考表示');
    expect(workspace).toContain('ここに表示する内容は正式な契約レコードではありません。');
    expect(workspace).toContain('正式な契約状態は未登録');
    expect(workspace).toContain('受注契約日（メモ）');
    expect(workspace).toContain('承諾見積額（参考）');
    expect(workspace).toContain('契約対象見積候補');
    expect(workspace).toContain('第{quote.revision}版／未固定');
    expect(workspace).toContain('支払条件（メモ）');
    expect(workspace).toContain("caseDocuments.filter((row) => row.kind === 'contract')");
    expect(workspace).toContain('data-testid="case-contract-documents"');
    expect(workspace).toContain('契約書はまだ正式保管されていません。アップロード・版管理は次工程で実装します。');
    expect(workspace).toContain('data-testid="case-drawings-and-documents"');
    expect(workspace).toContain("caseDocuments.filter((row) => row.kind !== 'contract')");
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
