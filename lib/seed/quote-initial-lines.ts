import type { QuoteInitialLine } from '@/lib/domain/types';

/**
 * 見積の編集で「別途工事」に最初から並べる 9 種類の工事（ローカル検証モードの初期データ専用）。
 * Supabase は migration 20261104110000 で同じ 9 件を入れる（2026-11-04 先方回答 A-3：別途工事の 9 品目は商品台帳から削除し、
 * 代理店の Excel 風の見積編集の初期明細にする）。名前と並びは、削除した 9 品目のまま
 */
export const INITIAL_QUOTE_LINES: QuoteInitialLine[] = [
  { section_code: 'sitework', name: '運送費', unit: '式', sort_order: 1 },
  { section_code: 'sitework', name: '設計監理及び確認申請費', unit: '式', sort_order: 2 },
  { section_code: 'sitework', name: '梱包養生', unit: '式', sort_order: 3 },
  { section_code: 'sitework', name: '現場設置工事', unit: '式', sort_order: 4 },
  { section_code: 'sitework', name: '電気設備工事', unit: '式', sort_order: 5 },
  { section_code: 'sitework', name: '給排水給湯設備工事', unit: '式', sort_order: 6 },
  { section_code: 'sitework', name: '基礎工事（設置後工事）', unit: '式', sort_order: 7 },
  { section_code: 'sitework', name: '廃材処分費', unit: '式', sort_order: 8 },
  { section_code: 'sitework', name: '別途現場諸費用', unit: '式', sort_order: 9 },
];
