import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const page = read('app/admin/standard-estimates/[revisionId]/page.tsx');
const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');
const workspace = read('lib/data/standard-estimate-workspace.ts');
const actions = read('lib/actions/standard-estimate-v25.ts');
const data = read('lib/data/standard-estimate-v25.ts');

describe('標準見積 v2.5 の編集（PR-B1b の処理を「見積書管理 ＞ 標準見積」の Excel 風の画面につなぐ）', () => {
  it('v2.5 の列が DB に無い間は従来の画面だけを出す（本番に migration が無くても壊れない）', () => {
    expect(data).toContain('if (isMissingColumn(error)) return null;');
    expect(page).toContain('const v25Header = await getStandardEstimateV25Header(supabase, revision.id);');
    expect(page).toContain("const isV25 = v25Header?.pricing_model === 'v2.5';");
    expect(page).toContain('{v25Header && !isV25 && (');
    // Excel 風の画面の一覧も、pricing_model が無い DB では v2.5 以前として扱う
    expect(workspace).toContain('if (revisionError && isMissingColumn(revisionError)) {');
  });

  it('v2.5 の Revision の編集は Excel 風の画面だけで行い、版の詳細からはその画面へ案内する（編集画面を 2 つにしない）', () => {
    expect(page).not.toContain('StandardEstimateV25Editor');
    expect(page).toContain('data-testid="standard-estimate-v25-workbench-link"');
    expect(page).toContain('/admin/estimate-templates?master=${revision.standard_estimate_master_id}');
    expect(page).toContain('{!isV25 && (\n      <StandardEstimateEditor');
    expect(page).toContain('{!isV25 && (\n      <StandardEstimateBaselineEditor');
    // v2.5 で公開した標準見積の次の下書きは v2.5 の下書きとして作る（旧来の「次の Revision」は出さない）
    expect(page).toContain("{!isDraft && revision.status === 'published' && !isV25 && (");
    expect(page).toContain('次の v2.5 の下書きを作成');
    expect(fs.existsSync(path.join(root, 'components/admin/standard-estimate-v25-editor.tsx'))).toBe(false);
  });

  it('v2.5 以前の下書きの切り替えは、画面が読んだ版を送り、確認ダイアログを通す。作った後は Excel 風の画面へ戻る', () => {
    expect(page).toContain('<input type="hidden" name="expected_draft_lock_version" value={revision.lock_version} />');
    expect(page).toContain('この下書きを v2.5 に切り替える');
    expect(page).toContain('<ConfirmSubmit');
    expect(actions).toContain("supabase.rpc('start_standard_estimate_v25_draft'");
    expect(actions).toContain('p_expected_draft_lock_version: draftLock');
    expect(actions).toContain('redirect(`/admin/estimate-templates?master=${masterId.data}&started=1`);');
  });

  it('商品の候補は、その仕様でお客様が選べる販売中の商品と公開中の選択肢（保存済みの販売停止・廃番は表示・保持だけ）', () => {
    expect(workspace).toContain("isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && savedOptionIds.has(option.id))");
    expect(workspace).toContain('.filter((group) => group.option_id === option.id)');
    expect(workbench).toContain('candidate?.retired && <Badge tone="warn">販売停止</Badge>');
    // 今はこの仕様で選べない保存済みの商品も、行を隠さずに出して削除を促す
    expect(workspace).toContain('unavailable: true,');
    expect(workbench).toContain('この仕様では選べない商品（削除してください）');
    // 新しく選べるのは販売中の商品だけ
    expect(workbench).toContain('!candidate.retired &&');
  });

  it('別途見積は 0 円と表示せず「未確定」、原価の状態（最新・更新あり・未設定）と公開できない理由を示す', () => {
    expect(workbench).toContain("{slot.price_mode === 'por' ? (\n                              <Badge tone=\"warn\">未確定</Badge>");
    expect(workbench).toContain("{line.price_mode === 'por' ? (\n                              <Badge tone=\"warn\">未確定</Badge>");
    // 売価が未入力の行は 0 円と表示しない
    expect(workbench).toContain('<Badge tone="danger">売価未入力</Badge>');
    expect(workbench).toContain('V25_COST_STATUS_LABEL[status]');
    expect(workbench).toContain('公開できない理由');
    expect(workbench).toContain('...v25PublishBlockers(preview, dirty),');
    // シミュレーターと連携する選択枠の決まりに合わなければ公開できない（DB も公開で止める）
    expect(workbench).toContain('const slotRuleIssues = useMemo(() => v25SlotRuleIssues(state.slots, (optionId) => candidateById.get(optionId)), [state.slots, candidateById]);');
  });

  it('保存は入力の確認の後、最新原価の取り込みは未保存の変更が無いときだけ、公開は確認ダイアログを通す', () => {
    expect(workbench).toContain('const problem = percentProblem(percents) ?? validateV25EditorState(state, sectionOf);');
    expect(workbench).toContain('disabled={pending || dirty} data-testid="v25-wb-refresh"');
    expect(workbench).toContain('<ConfirmActionButton');
    expect(workbench).toContain('disabled={pending || blockers.length > 0}');
    expect(workbench).toContain('expected_lock_version: lockVersion');
  });

  it('別途工事の商品は自動計算を選べず、選ぶと別途見積にする。保存前の確認でも止める', () => {
    expect(workbench).toContain("disabled={mode === 'auto' && code === 'sitework'}");
    expect(workbench).toContain("const priceMode: V25SlotPriceMode = candidate.section === 'sitework' ? 'por' : 'auto';");
    expect(workbench).toContain('validateV25EditorState(state, sectionOf)');
  });

  it('以前の標準見積から写した明細は「要見直し」と示し、見直し済みにできる。新しい明細は別途見積から始める（0 円にしない）', () => {
    expect(workbench).toContain('要見直し → 見直し済みにする');
    expect(workbench).toContain('review_required: false');
    expect(workbench).toContain("price_mode: 'por',");
  });

  it('Server Action は RPC を呼ぶだけ（本部の管理者だけ・ローカル検証モードでは使わない）', () => {
    expect(actions.startsWith("'use server';")).toBe(true);
    expect((actions.match(/await requireAdmin\('\/admin\/standard-estimates'\);/g) ?? []).length).toBe(4);
    for (const rpc of ['save_standard_estimate_v25_draft', 'refresh_standard_estimate_v25_costs', 'publish_standard_estimate_v25_revision']) {
      expect(actions).toContain(`supabase.rpc('${rpc}'`);
    }
    expect(actions).toContain('localUnavailable()');
    // 金額は計算しない（DB が計算する。画面の試算は表示だけ）
    expect(actions).not.toMatch(/Math\.trunc|calculatePricingV25/);
  });
});
