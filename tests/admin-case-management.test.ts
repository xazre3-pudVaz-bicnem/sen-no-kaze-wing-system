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
const dealerForms = fs.readFileSync(path.join(root, 'components/admin/dealer-forms.tsx'), 'utf8');
const manualQuoteForm = fs.readFileSync(path.join(root, 'components/admin/manual-quote-form.tsx'), 'utf8');
const casePlanBoard = fs.readFileSync(path.join(root, 'components/admin/case-plan-board.tsx'), 'utf8');
const clickableCaseRow = fs.readFileSync(path.join(root, 'components/admin/clickable-case-row.tsx'), 'utf8');
const caseAdminControls = fs.readFileSync(path.join(root, 'components/admin/case-admin-controls.tsx'), 'utf8');
const newQuote = fs.readFileSync(path.join(root, 'app/admin/quotes/new/page.tsx'), 'utf8');
const configurations = fs.readFileSync(path.join(root, 'app/admin/configurations/page.tsx'), 'utf8');
const contacts = fs.readFileSync(path.join(root, 'app/admin/contacts/page.tsx'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'app/admin/notifications/page.tsx'), 'utf8');
const adminActions = fs.readFileSync(path.join(root, 'lib/actions/admin.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');
const schemaCompat = fs.readFileSync(path.join(root, 'lib/data/schema-compat.ts'), 'utf8');
const dealerRequestMetaMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260927150000_dealer_quote_request_meta.sql'),
  'utf8'
);

describe('Admin case management UI', () => {
  it('keeps the case list payload small and defers case workspace loading until selection', () => {
    expect(list).toContain('store.listQuoteRequests()');
    expect(list).toContain('store.listAllQuotes()');
    expect(list).toContain('store.listCaseDealers()');
    expect(list).not.toContain('store.getConfigurationCount()');
    expect(list).not.toContain('store.getNewContactMessageCount()');
    expect(list).not.toContain('store.listAllConfigurations()');
    expect(list).not.toContain('store.listModels({ includeDraft: true })');
    expect(list).not.toContain('store.listProfiles()');
    expect(list).not.toContain('store.listContactMessages()');
    expect(list).not.toContain('latest.map((q) => store.getQuote(q.id, actor))');
    expect(list).toContain('const selectedQuoteId = selectedPendingRequest ? null : requestedCase;');
    expect(list).toContain('{selectedQuoteId ? (');
  });

  it('restores dealer request metadata through the list query without per-quote detail loading', () => {
    expect(list).toContain("quote.request_status === 'new'");
    expect(list).toContain('QUOTE_REQUEST_STATUS_LABELS[q.request_status]');
    expect(list).toContain("q.site_address || '未登録'");
    expect(list).not.toContain('q.address');
    expect(list).not.toContain('latest.map((q) => store.getQuote(q.id, actor))');
    expect(list).toContain("const selectedQuoteId = requestedCase;");
    expect(store).toContain('export type DealerQuoteListItem');
    expect(store).toContain('request_status: QuoteRequestStatus | null;');
    expect(store).toContain('site_address: string | null;');
    expect(supabaseStore).toContain("db.rpc('list_dealer_quote_request_meta')");
    expect(supabaseStore).toContain('requestMetaByQuoteId');
    expect(supabaseStore).toContain('if (requestMetaError && !isMissingFunction(requestMetaError)) mapPgError(requestMetaError);');
    expect(supabaseStore).toContain('const requestMetaRows = requestMetaError ? [] : requestMeta ?? [];');
    expect(supabaseStore).not.toContain('quote_requests!quotes_quote_request_id_fkey');
    expect(schemaCompat).toContain('export function isMissingFunction');
    expect(dealerRequestMetaMigration).toContain("security definer\nset search_path = ''");
    expect(dealerRequestMetaMigration).toContain('q.dealer_id = (select auth.uid())');
    expect(dealerRequestMetaMigration).toContain('(select public.is_dealer())');
    expect(dealerRequestMetaMigration).toContain('join public.quote_requests as r on r.id = q.quote_request_id');
    expect(dealerRequestMetaMigration).toContain("r.contact ->> 'site_address'");
    expect(dealerRequestMetaMigration).not.toContain("r.contact ->> 'address'");
    expect(dealerRequestMetaMigration).not.toContain('\n  address text');
    expect(dealerRequestMetaMigration).not.toContain('r.message');
    expect(dealerRequestMetaMigration).not.toContain('select r.*');
    expect(dealerRequestMetaMigration).toContain('from public, anon, authenticated, service_role;');
    expect(dealerRequestMetaMigration).toContain('alter function public.list_dealer_quote_request_meta() owner to postgres;');
    expect(dealerRequestMetaMigration).toContain("'public.list_dealer_quote_request_meta()'::regprocedure");
    expect(dealerRequestMetaMigration).toContain('DEALER_QUOTE_REQUEST_LIST_OWNER_INVALID');
    expect(dealerRequestMetaMigration).toContain('grant execute on function public.list_dealer_quote_request_meta() to authenticated;');
  });

  it('keeps case utilities contextual instead of rendering a fixed second-level menu', () => {
    for (const route of ['/admin/configurations', '/admin/contacts', '/admin/notifications', '/admin/customer-management']) {
      expect(nav).toContain(route);
    }
    for (const label of ['案件一覧', '保存済み仕様', '問い合わせ受付']) {
      expect(nav).not.toContain(`label: '${label}'`);
    }
    expect(list).toContain('href="/admin/customer-management"');
    expect(list).toContain('href="/admin/contacts"');
    expect(list).toContain('href="/admin/notifications"');
    expect(list).toContain('＋対面・電話・紹介の案件受付');
    expect(list).toContain('href="/admin/quotes/new"');
  });

  it('uses one case flow for Web and staff-received orders without calling revisions new quotes', () => {
    expect(list).toContain('Web見積依頼と、対面・電話・紹介で受け付けた案件 {caseCount} 件をまとめて管理します。');
    expect(newQuote).toContain('Web以外で受けた案件を登録し、概算見積を作成します。作成後はWeb経由の案件と同じ案件管理で進めます。');
    expect(manualQuoteForm).toContain('案件を登録して概算見積を作成');
    expect(manualQuoteForm).toContain('現地確認後は「見積内容を更新」から施工金額や商品変更を反映');
    expect(quoteEstimateSheet).toContain('見積内容を更新');
    expect(quoteEstimateSheet).not.toContain('＋新しい見積書');
    expect(dealerForms).toContain('現地確認後の施工金額やオプション・別途工事等を見積に反映し、改訂見積を発行できます。');
    expect(dealerForms).toContain('見積内容を編集中');
    expect(dealerForms).toContain('改訂後の見積合計（税込）');
    expect(dealerForms).toContain('この内容で改訂見積を発行');
  });

  it('uses case management itself as the admin landing page', () => {
    expect(dashboard).toContain("redirect('/admin/quotes')");
    expect(dashboard).not.toContain('まず確認すること');
    expect(dashboard).not.toContain('最近の案件受付');
    expect(dashboard).not.toContain('getStore');
  });

  it('keeps the list dense and shows the selected case workspace on the same page', () => {
    expect(list).toContain('data-testid="case-summary-strip"');
    expect(list).toContain('案件状況');
    expect(list).toContain('各案件の現在金額合計');
    expect(list).toContain('data-testid="case-summary-finance"');
    expect(list).toContain('data-testid="case-summary-disaster"');
    expect(list).toContain('完成個体登録後に供給可否を管理');
    expect(list).not.toContain('災害時供給 <strong');
    expect(list).not.toContain('契約・製造・原価・利益・災害時供給は今後対応予定');
    expect(list).toContain('案件を選択すると、下のワークスペースが切り替わります。');
    expect(list).not.toContain('max-h-[20rem] overflow-auto');
    expect(list).toContain('<ClickableCaseRow');
    expect(clickableCaseRow).toContain("data-selected={selected ? 'true' : undefined}");
    expect(clickableCaseRow).toContain('tabIndex={0}');
    expect(clickableCaseRow).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(list).toContain("selected ? 'bg-[#fff7df]");
    expect(list).toContain('caseSelectionHref');
    expect(list).toContain('requestSelectionHref');
    expect(list).toContain('data-testid="pending-request-link"');
    expect(list).toContain('<CaseWorkspace');
    expect(list).toContain('embedded');
    expect(list).toContain('listSearchParams={sp}');
    expect(list).toContain('顧客・住所・見積番号・商品モデル');
    expect(list).toContain('状態：すべて');
    expect(list).toContain('担当：すべて');
    expect(list).toContain('data-testid="case-list-scroll"');
    expect(list).toContain('見積番号');
    expect(list).toContain('工程・状態');
    expect(list).toContain('caseQuoteStatusLabel');
    expect(list).toContain('casePhaseLabel');
    expect(list).toContain('概算見積 承諾履歴');
    expect(list).toContain('確定見積 承諾済み');
    expect(list).toContain('現在工程：{casePhaseLabel');
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

  it('opens quote requests that do not have a quote yet without creating a duplicate request', () => {
    expect(list).toContain("query.set('request', requestId)");
    expect(list).toContain('#pending-quote-request');
    expect(list).toContain('selectablePendingRequestIds');
    expect(list).toContain('selectedPendingRequest');
    expect(list).toContain('data-testid="pending-quote-request-workspace"');
    expect(list).toContain('見積未発行');
    expect(list).toContain('次工程：見積作成');
    expect(list).toContain('data-testid="pending-request-customer"');
    expect(list).toContain('data-testid="pending-request-configuration"');
    expect(list).toContain('data-testid="pending-request-message"');
    expect(list).toContain('data-testid="pending-request-next-step"');
    expect(list).toContain('正式処理は未実装');
    expect(list).toContain('Quote lifecycle用のDB/RPC対応が必要です。');
    expect(list).toContain('このWeb受付の引継ぎには使用しません。');
    expect(list).not.toContain('href={`/admin/quotes/new?request=');
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
    expect(workspace).toContain('data-testid="case-workflow-flow"');
    expect(workspace).toContain('data-testid="case-workflow-arrow"');
    expect(workspace).toContain("aria-current={step.state === 'current' ? 'step' : undefined}");
    expect(workspace).toContain('min-w-[58rem]');
    expect(workspace).toContain('<CaseAdminControls>');
    expect(caseAdminControls).toContain('案件設定');
    expect(caseAdminControls).toContain('案件設定を閉じる');
    expect(workspace).toContain('現在フェーズ：{currentPhaseLabel}');
    expect(workspace).toContain("const isFormalAccepted = acceptedQuoteCaseState === 'formal_current';");
    expect(workspace).toContain('確定見積の承諾履歴（最新状態要確認）');
    expect(workspace).toContain("casePlanConfiguration?.configuration.name?.trim() || customerCompany || customerName");
    expect(workspace).toContain('契約条件の確認');
    expect(workspace).toContain("value: isFormalAccepted ? '正式状態未登録' : isFormalAcceptedUnconfirmed ? '最新状態要確認' : '未対応'");
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

  it('guides all case-management roles to the next concrete task without role-specific labels', () => {
    expect(workspace).toContain('data-testid="case-next-action"');
    expect(workspace).toContain('data-testid="case-next-action-link"');
    expect(workspace).toContain('次にやること：担当代理店を決める');
    expect(workspace).toContain('担当代理店が未設定です。担当を決めてから、現地確認と施工金額の確定へ進めてください。');
    expect(workspace).toContain('案件設定で担当を選ぶ');
    expect(workspace).toContain('次にやること：現地を確認して施工金額を入力');
    expect(workspace).toContain('搬入経路、基礎、電気、給排水、設置工事などを確認し、「見積内容を更新」から必要な施工金額を入力します。');
    expect(workspace).toContain('現地確認の完了状態そのものはまだ保存されません。');
    expect(workspace).toContain('施工金額を入力する');
    expect(workspace).toContain('次にやること：確定見積の内容を確認');
    expect(workspace).toContain('確定見積を確認・更新');
    expect(workspace).toContain('次にやること：契約内容を確認');
    expect(workspace).toContain('契約・資料を確認');
    expect(workspace).not.toContain("const isDealer = actor.role === 'dealer'");
    expect(workspace).not.toContain('DEALER_TAB_LABELS');
    expect(workspace).not.toContain('displayLabel = isDealer');
    expect(workspace).toContain('const referenceLabel =');
    expect(workspace).toContain("tabItem.key === 'documents'");
    expect(workspace).toContain('const needsDealerAssignment =');
    expect(workspace).toContain('const needsSiteConfirmation =');
    expect(workspace).toContain("href: tabHref('estimate', true)");
    expect(workspace).toContain("if (edit) query.set('edit', '1')");
    expect(workspace).toContain("key === 'edit'");
    expect(workspace).toContain('施工金額を見積へ反映');
    expect(workspace).toContain('お客様へ確定見積を案内');
  });

  it('keeps the HTML-style workflow and tabs without inventing downstream workflow data', () => {
    for (const label of ['案件受付', '概算見積', '担当決定', '現地確認', '確定見積', '契約', '製造・施工', '引渡し', 'アフター']) {
      expect(workspace).toContain(label);
    }
    for (const label of ['見積', 'プラン', '現地確認', '契約・資料', '製造・施工', '引渡し・アフター', '災害時提供']) {
      expect(workspace).toContain(label);
    }
    expect(workspace).toContain('参考表示');
    expect(workspace).toContain('未判定');
    expect(workspace).toContain('<QuoteEstimateSheet');
    expect(workspace).toContain("key={edit === '1' ? 'edit' : 'view'}");
    expect(workspace).toContain("startInEditMode={Boolean(created) || edit === '1'}");
    expect(list).toContain('edit={sp.edit}');
    expect(detail).toContain('edit={sp.edit}');
    expect(workspace).not.toContain('<DealerRevisionForm quote={quote}');
    expect(quoteEstimateSheet).toContain('showSelectedImages={false}');
    expect(quoteEstimateSheet).toContain('<DealerRevisionForm');
    expect(workspace).toContain("<AssignDealerForm key={quote.dealer_id ?? 'unassigned'} quote={quote} dealers={dealers} />");
    expect(workspace).not.toContain('<QuoteStatusForm');
    expect(workspace).toContain("const isFormal = isFormalQuote(quote);");
    expect(workspace).toContain("const isFormalAccepted = acceptedQuoteCaseState === 'formal_current';");
    expect(workspace).toContain("const isFormalAcceptedUnconfirmed = acceptedQuoteCaseState === 'formal_unconfirmed';");
    expect(workspace).toContain("const isPreliminaryAccepted = acceptedQuoteCaseState === 'preliminary';");
    expect(workspace).toContain("isPreliminaryAccepted ? '承諾履歴あり' : '発行済み'");
    expect(workspace).toContain('第${quote.revision}版');
    expect(workspace).toContain(": '未発行'");
    expect(workspace).not.toContain("quote.revision === 1 ? '概算見積'");
    expect(workspace).not.toContain("quote.revision > 1 ? '確定見積'");
    expect(caseAdminControls).toContain('data-testid="case-admin-controls"');
    expect(workspace).toContain('<h2 className="text-lg font-semibold">見積</h2>');
    expect(workspace).toContain("{isFormal ? '確定見積' : '概算見積'}");
    expect(workspace).toContain('見積書');
    expect(workspace).toContain('見積番号 {quote.quote_no}／発行');
    expect(workspace).toContain('data-testid="admin-pdf-link"');
    expect(workspace).toContain('PDF再生成');
    expect(workspace).not.toContain('この見積のPDF・画像');
    expect(workspace).toContain('金額はこの見積版の発行時点で保存された内容です。');
    expect(workspace).not.toContain('金額は発行時点のスナップショットです。');
  });

  it('returns to the inline case workspace after issuing a new quote revision', () => {
    expect(adminActions).toContain('redirect(`/admin/quotes?case=${encodeURIComponent(newId)}&tab=estimate&revised=1#case-workspace`)');
    expect(list).toContain('revised={sp.revised}');
    expect(workspace).toContain('第${quote.revision}版を発行しました');
  });

  it('does not present unsupported downstream workflow data as implemented', () => {
    expect(workspace).toContain('data-testid="case-data-status"');
    expect(workspace).toContain('既存データで確認できる項目');
    expect(workspace).toContain('顧客、担当代理店、設置予定地、保存済みプラン、発行済み見積、登録済み案件資料');
    expect(workspace).toContain('正式状態が未実装の項目');
    expect(workspace).toContain('現地確認完了、契約Revision固定・契約成立、製造指示・個体ID・工程進捗、引渡し、保証・点検・修理履歴');
    expect(workspace).toContain('案件受付・現地メモ');
    expect(workspace).toContain('data-testid="case-tab-site"');
    expect(workspace).toContain('現地確認の正式完了状態はまだ保存されません');
    expect(workspace).toContain('候補情報が埋まっていても「現地確認完了」にはなりません。');
    expect(workspace).toContain('施工金額を見積へ反映');
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
    expect(workspace).toContain('現在の見積状態');
    expect(workspace).toContain('受注契約日（メモ）');
    expect(workspace).toContain('現在の見積額（参考）');
    expect(workspace).toContain('契約対象Revision');
    expect(workspace).toContain('正式未固定');
    expect(workspace).toContain('概算見積の承諾履歴');
    expect(workspace).toContain('確定見積の承諾履歴（最新状態要確認）');
    expect(workspace).toContain("'見積承諾済み'");
    expect(workspace).toContain('data-testid="case-drawing-grid"');
    expect(workspace).toContain('data-testid="case-document-list"');
    expect(workspace).toContain('data-testid="case-document-notes"');
    expect(workspace).toContain('案件構成・申し送り');
    expect(workspace).toContain('受注・契約メモ');
    expect(workspace).toContain('現在の見積書PDF');
    expect(workspace).toContain('原本保管は未実装');
    expect(workspace).toContain('製造開始日、製造完了日、製造個体番号、搬入予定日、施工予定日、担当組織・担当者、各工程の進捗を保存する正式機能はまだありません。');
    expect(workspace).toContain("['製造指示', '正式保存先なし']");
    expect(workspace).toContain("['対象Revision', '正式未固定']");
    expect(workspace).toContain("['個体ID', '未発行']");
    expect(workspace).toContain("['製造進捗', '正式保存先なし']");
    expect(workspace).toContain("['施工進捗', '正式保存先なし']");
    expect(workspace).toContain('保証開始日・保証期限、点検予定・点検履歴、不具合・修理・問い合わせなどのアフター対応履歴を保存する正式機能はまだありません。');
    expect(workspace).toContain("['保証状態', '正式保存先なし']");
    expect(workspace).toContain("['点検予定・履歴', '正式保存先なし']");
    expect(workspace).toContain("['不具合・修理履歴', '正式保存先なし']");
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
    expect(workspace).toContain("['保証状態', '正式保存先なし']");
    expect(workspace).toContain("['点検予定・履歴', '正式保存先なし']");
    expect(workspace).toContain("['不具合・修理履歴', '正式保存先なし']");
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
    expect(workspace).toContain('現在の見積額（参考）');
    expect(workspace).toContain('契約対象Revision');
    expect(workspace).toContain('現在表示：{quote.quote_no} 第{quote.revision}版');
    expect(workspace).toContain('支払条件（メモ）');
    expect(workspace).toContain("caseDocuments.filter((row) => row.kind === 'contract')");
    expect(workspace).toContain('data-testid="case-contract-documents"');
    expect(workspace).toContain('契約書はまだ正式保管されていません。アップロード・版管理は次工程で実装します。');
    expect(workspace).toContain('data-testid="case-drawings-and-documents"');
    expect(workspace).toContain("caseDocuments.filter((row) => row.kind !== 'contract')");
  });

  it('keeps the existing case-related routes while removing their fixed submenu', () => {
    for (const route of ['/admin/quotes', '/admin/configurations', '/admin/contacts', '/admin/notifications', '/admin/customer-management']) {
      expect(nav).toContain(route);
    }
    expect(newQuote).toContain('<BackLink href="/admin/quotes" label="案件一覧へ戻る" />');
    expect(newQuote).toContain('title="対面・電話・紹介の案件受付"');
    expect(configurations).toContain('title="保存済み仕様"');
    expect(contacts).toContain('title="問い合わせ受付"');
  });

  it('aligns assignment notifications with the current site-work flow', () => {
    expect(notifications).toContain("n.kind === 'quote_assigned' ? '施工金額を入力' : '開く'");
    expect(notifications).not.toContain('別途工事を入力');
  });

  it('prioritizes the saved installation location in the saved-configuration list', () => {
    expect(configurations).toContain('configuration.site_location_undecided');
    expect(configurations).toContain('configuration.site_prefecture');
    expect(configurations).toContain('configuration.site_municipality');
    expect(configurations).toContain('設置予定地');
    expect(configurations).toContain('顧客住所から参考表示');
    expect(configurations).toContain('未登録時のみ顧客住所で判定');
    expect(configurations).toContain('「未定」は地域絞り込みの対象外です。');
    expect(configurations).not.toContain('parseAddress(c.user_address)');
    expect(configurations).not.toContain('matchesRegion(c.user_address, filter)');
  });
});
