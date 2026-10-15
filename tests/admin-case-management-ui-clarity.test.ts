import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace.tsx'), 'utf8');

const listParamKeys = "['q', 'status', 'dealer', 'pref', 'city', 'phase', 'model', 'sort']";

describe('案件管理UIの未登録・準備中・権限表示と一覧復帰', () => {
  it('入力可能な未入力値は未登録・未割当として表示する', () => {
    expect(page).toContain("request.contact.site_address || '未登録'");
    expect(page).toContain("<span className=\"text-muted\">未割当</span>");
    expect(workspace).toContain("caseUnitCount ?? '未登録'");
    expect(workspace).toContain("caseStructureNote ?? '未登録'");
  });

  it('未実装機能を未登録と混同せず準備中として表示する', () => {
    // 契約書の保管・版管理など、まだ作っていない機能は準備中と表示する
    expect(workspace).toContain('契約書の保管・差替え・版管理は現在準備中です。');
    expect(workspace).toContain('案件資料のアップロード機能は現在準備中です。');
    expect(workspace).not.toContain('正式保存先なし');
    expect(workspace).not.toContain('正式管理は未実装');
    expect(workspace).not.toContain('バックエンド実装が必要');
  });

  it('案件の流れは、案件の進行の正式な記録（現地確認・契約・製造・引渡し・アフター）から表示する', () => {
    expect(workspace).toContain('const caseFlow = await getCaseFlowStore();');
    for (const fragment of [
      "flowProgress?.site_survey_status === 'completed'",
      "value: flowSigned ? '締結済み'",
      'MANUFACTURING_ORDER_STATUS_LABELS[flowManufacturing]',
      "value: flowHandover ? HANDOVER_STATUS_LABELS[flowHandover.status] : '未着手'",
      "'引渡し後に受付'",
    ]) {
      expect(workspace).toContain(fragment);
    }
    // 準備中の固定表示は残さない
    expect(workspace).not.toContain("{ label: '製造・施工', value: '準備中', state: 'pending' }");
    expect(workspace).not.toContain("{ label: '引渡し', value: '準備中', state: 'pending' }");
  });

  it('権限による未取得をデータなしと断定しない', () => {
    expect(page).toContain('この権限では保存済み仕様の詳細を表示していません。');
    expect(workspace).toContain('この権限では詳細を表示できない場合があります。');
    expect(workspace).toContain('if (!canViewAllQuotes && quote.dealer_id !== actor.id && !isSalesManagerView) notFound();');
  });

  it('案件詳細から一覧へ戻る導線があり一覧条件を保持する', () => {
    expect(page).toContain(`const LIST_PARAM_KEYS = ${listParamKeys} as const;`);
    expect(workspace).toContain(`const CASE_LIST_PARAM_KEYS = ${listParamKeys} as const;`);
    expect(page).toContain('data-testid="pending-request-back-to-list"');
    expect(workspace).toContain('data-testid="case-back-to-list"');
    expect(workspace).toContain('href={caseListHref}');
    expect(workspace).toContain('const caseListHref = buildCaseListHref(listSearchParams);');
  });

  it('利用者向けの技術用語を業務用語へ置き換える', () => {
    expect(workspace).not.toContain('Configurationとの紐付け');
    expect(workspace).not.toContain('Quoteメモから抽出');
    expect(workspace).not.toContain('対象Revision');
    expect(workspace).not.toContain('契約レコード');
    expect(workspace).toContain('対象見積版');
    expect(workspace).toContain('受注・契約メモから表示');
  });

  it('既存のadmin / master_dealer / dealer権限制御を変更しない', () => {
    expect(page).toContain("if (actor.role !== 'admin')");
    expect(workspace).toContain("const isAdmin = actor.role === 'admin';");
    expect(workspace).toContain('const canViewAllQuotes = isAdmin;');
  });
});
