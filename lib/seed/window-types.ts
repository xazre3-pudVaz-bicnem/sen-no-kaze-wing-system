import type { WindowType } from '@/lib/domain/types';

/**
 * 窓タイプの初期値（ローカル検証モードの初期データ専用。Supabase は migration 20261102100000 で同じ 4 件を入れる）。
 * 2026-10-30 先方回答：サッシの商品の開閉形式だけ（「掃出し窓」などの用途・形状は入れない）。足す・変えるのは管理画面から
 */
export const INITIAL_WINDOW_TYPES: WindowType[] = [
  { code: 'fix', label: 'FIX窓', sort_order: 10, status: 'active' },
  { code: 'sliding', label: '引違い窓', sort_order: 20, status: 'active' },
  { code: 'casement', label: '縦すべり出し窓', sort_order: 30, status: 'active' },
  { code: 'awning', label: '横すべり出し窓', sort_order: 40, status: 'active' },
];
