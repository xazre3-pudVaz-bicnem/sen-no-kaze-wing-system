import 'server-only';
import type { SessionUser } from '@/lib/data/store';
import type { CaseAccess } from '@/lib/domain/case-flow';
import type { CaseFlowStore } from './store';

/** 案件画面のパネル（製造・施工／引渡し・アフター）を見る立場 */
export interface CasePanelAccess {
  /** 表示に使う関わり方（読み取りだけのときは担当（staff）と同じ内容を見せる） */
  access: CaseAccess;
  /** 操作（書き込みのフォーム・削除）を出さない */
  readOnly: boolean;
}

/**
 * 案件画面のパネルの関わり方。書き込みの判定（DB の case_access）で担当・製造の担当・本部ならそのまま、
 * 営業担当組織の管理者（読み取りの判定 case_role が manager）は担当と同じ内容を読み取りだけで見せる
 * （DB の権限に「読み取りだけ」の段階は無いため、ここでまとめて決める。編集は自分を主担当者にして行う）。見せない人は null
 */
export async function casePanelAccess(caseFlow: CaseFlowStore, actor: SessionUser, requestId: string): Promise<CasePanelAccess | null> {
  const access = await caseFlow.getCaseAccess(actor, requestId);
  if (access && access !== 'customer') return { access, readOnly: false };
  if ((await caseFlow.getCaseRole(actor, requestId)) === 'manager') return { access: 'staff', readOnly: true };
  return null;
}
