import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const completeWorkspace = fs.readFileSync(path.join(root, 'components/admin/case-workspace-complete.tsx'), 'utf8');
const detailPage = fs.readFileSync(path.join(root, 'app/admin/quotes/[id]/page.tsx'), 'utf8');

describe('案件管理・契約以降UIモック', () => {
  it('案件一覧に次アクションと将来フェーズの表示イメージを持つ', () => {
    expect(page).toContain('caseNextActionLabel');
    expect(page).toContain('次にやること');
    expect(page).toContain("['契約', '製造依頼', '製造中', '施工中', '引渡し待ち', '引渡し済み', 'アフター']");
    expect(page).toContain('data-testid="case-future-phase-preview"');
    expect(page).toContain('正式な状態・判定はDB実装後');
  });

  it('一覧の横スクロールと先頭列stickyを維持する', () => {
    expect(page).toContain('data-testid="case-list-scroll"');
    expect(page).toContain('min-w-[72rem]');
    expect(page).toContain('sticky left-0 z-20');
    expect(page).toContain('sticky left-0 z-[1]');
  });

  it('契約モックに対象Revision・契約金額・変更履歴を表示する', () => {
    expect(completeWorkspace).toContain('契約対象Revision');
    expect(completeWorkspace).toContain('契約金額');
    expect(completeWorkspace).toContain('契約確定・変更履歴');
    expect(completeWorkspace).toContain('契約変更履歴は未保存です');
  });

  it('製造・施工モックに製造依頼から設備工事と写真までを表示する', () => {
    for (const label of ['製造依頼', '対象Revision', '棟数', '個体番号', '製造担当', '製造予定']) {
      expect(completeWorkspace).toContain(label);
    }
    for (const step of ['出荷', '搬入', '基礎', '設置', '電気', '給排水']) {
      expect(completeWorkspace).toContain(step);
    }
    expect(completeWorkspace).toContain('工程写真');
  });

  it('引渡し前の是正UIを持ち正式保存は行わない', () => {
    expect(completeWorkspace).toContain('是正・引渡し前確認');
    expect(completeWorkspace).toContain('是正事項');
    expect(completeWorkspace).toContain('是正完了確認');
    expect(completeWorkspace).toContain('UIモック・保存なし');
    expect(completeWorkspace).not.toContain('createContract');
    expect(completeWorkspace).not.toContain('updateContract');
    expect(completeWorkspace).not.toContain('createProduction');
    expect(completeWorkspace).not.toContain('updateProduction');
  });

  it('一覧・単独詳細の双方が補完ワークスペースを使う', () => {
    expect(page).toContain("@/components/admin/case-workspace-complete");
    expect(detailPage).toContain("@/components/admin/case-workspace-complete");
  });
});
