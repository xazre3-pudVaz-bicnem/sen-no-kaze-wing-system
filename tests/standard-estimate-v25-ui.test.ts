import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const page = read('app/admin/standard-estimates/[revisionId]/page.tsx');
const editor = read('components/admin/standard-estimate-v25-editor.tsx');
const actions = read('lib/actions/standard-estimate-v25.ts');
const data = read('lib/data/standard-estimate-v25.ts');

describe('標準見積 v2.5 の編集画面（PR-B1b）', () => {
  it('v2.5 の列が DB に無い間は従来の画面だけを出す（本番に migration が無くても壊れない）', () => {
    expect(data).toContain('if (isMissingColumn(error)) return null;');
    expect(page).toContain('const v25Header = await getStandardEstimateV25Header(supabase, revision.id);');
    expect(page).toContain("const isV25 = v25Header?.pricing_model === 'v2.5';");
    expect(page).toContain('{v25Header && !isV25 && (');
  });

  it('v2.5 の Revision は v2.5 の編集画面で開き、従来の明細・標準状態の編集は出さない', () => {
    expect(page).toContain('<StandardEstimateV25Editor');
    expect(page).toContain('{!isV25 && (\n      <StandardEstimateEditor');
    expect(page).toContain('{!isV25 && (\n      <StandardEstimateBaselineEditor');
    // v2.5 で公開した標準見積の次の下書きは v2.5 の下書きとして作る（旧来の「次の Revision」は出さない）
    expect(page).toContain("{!isDraft && revision.status === 'published' && !isV25 && (");
    expect(page).toContain('次の v2.5 の下書きを作成');
  });

  it('v2.5 以前の下書きの切り替えは、画面が読んだ版を送り、確認ダイアログを通す', () => {
    expect(page).toContain('<input type="hidden" name="expected_draft_lock_version" value={revision.lock_version} />');
    expect(page).toContain('この下書きを v2.5 に切り替える');
    expect(page).toContain('<ConfirmSubmit');
    expect(actions).toContain("supabase.rpc('start_standard_estimate_v25_draft'");
    expect(actions).toContain('p_expected_draft_lock_version: draftLock');
  });

  it('商品の候補は、その仕様でお客様が選べる販売中の商品と公開中の選択肢（保存済みの販売停止・廃番は表示・保持だけ）', () => {
    expect(page).toContain("isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && v25SavedOptionIds.has(option.id))");
    expect(page).toContain('.filter((group) => group.option_id === option.id)');
    expect(editor).toContain('{candidate?.retired && <option value={candidate.id} disabled>{candidate.name}（販売停止）</option>}');
  });

  it('別途見積は 0 円と表示せず、原価の状態（最新・更新あり・未設定）と公開できない理由を示す', () => {
    expect(editor).toContain("slot.price_mode === 'por' ? <Badge tone=\"warn\">別途見積</Badge>");
    expect(editor).toContain("line.price_mode === 'por'\n                      ? <Badge tone=\"warn\">別途見積</Badge>");
    expect(editor).toContain('V25_COST_STATUS_LABEL[status]');
    expect(editor).toContain('公開できない理由');
    expect(editor).toContain('const blockers = v25PublishBlockers(preview, dirty);');
  });

  it('保存は入力の確認の後、最新原価の取り込みは未保存の変更が無いときだけ、公開は確認ダイアログを通す', () => {
    expect(editor).toContain('const problem = validateV25EditorState(state, (optionId) => candidateById.get(optionId)?.section);');
    expect(editor).toContain('disabled={pending || dirty} data-testid="v25-refresh"');
    expect(editor).toContain('<ConfirmActionButton');
    expect(editor).toContain('disabled={pending || blockers.length > 0}');
    expect(editor).toContain('expected_lock_version: lockVersion');
  });

  it('別途工事の商品は自動計算を選べず、選ぶと別途見積にする。保存前の確認でも止める', () => {
    expect(editor).toContain("disabled={mode === 'auto' && candidate?.section === 'sitework'}");
    expect(editor).toContain("next?.section === 'sitework' && slot.price_mode === 'auto' ? { price_mode: 'por' as const } : {}");
    expect(editor).toContain('validateV25EditorState(state, (optionId) => candidateById.get(optionId)?.section)');
  });

  it('以前の標準見積から写した明細は「要見直し」と示し、見直し済みにできる', () => {
    expect(editor).toContain('要見直し → 見直し済みにする');
    expect(editor).toContain('review_required: false');
  });

  it('Server Action は RPC を呼ぶだけ（本部の管理者だけ・ローカル検証モードでは使わない）', () => {
    expect(actions.startsWith("'use server';")).toBe(true);
    expect((actions.match(/await requireAdmin\('\/admin\/standard-estimates'\);/g) ?? []).length).toBe(4);
    for (const rpc of ['save_standard_estimate_v25_draft', 'refresh_standard_estimate_v25_costs', 'publish_standard_estimate_v25_revision']) {
      expect(actions).toContain(`supabase.rpc('${rpc}'`);
    }
    expect(actions).toContain('localUnavailable()');
    // 金額は計算しない（DB が計算する）
    expect(actions).not.toMatch(/Math\.trunc|calculatePricingV25/);
  });
});
