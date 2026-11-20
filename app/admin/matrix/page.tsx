import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';

export const metadata: Metadata = { title: '商品選択設定 | 管理画面', robots: { index: false } };

/** 既存の本部専用URLは残し、統合設定画面の仕様別タブへ案内する。 */
export default async function MatrixPage() {
  await requireAdmin('/admin/matrix');
  redirect('/admin/categories?tab=matrix');
}
