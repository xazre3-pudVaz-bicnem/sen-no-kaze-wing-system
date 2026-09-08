/**
 * コラム（/column）の型定義。
 * お知らせ（/news・data/site-content.ts の `news`）とは別機能。混在させない。
 */

/** 記事の公開状態。draft は本文・一覧・sitemap・API のどれにも出さない */
export type ColumnStatus = 'published' | 'draft';

/** 運用上の分類（タグの独立ページは作らない。一覧の絞り込み表示のみ） */
export const COLUMN_CATEGORIES = ['基礎知識', '土地活用', '比較検討', '設置・設備', '事業化'] as const;
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number];

/** 記事が根拠にした資料。捏造防止のため出典と確認日を必須にする */
export interface ColumnSource {
  label: string;
  /** 一次情報の URL。社内資料など URL が無い場合は省略 */
  url?: string;
  /** YYYY-MM-DD。実際に確認した日 */
  checkedAt: string;
}

/** 関連する固定ページへの内部リンク */
export interface ColumnRelatedPage {
  label: string;
  path: string;
}

export interface ColumnMeta {
  slug: string;
  title: string;
  /** meta description 兼 一覧の概要。120 文字以内を目安 */
  description: string;
  category: ColumnCategory;
  /** YYYY-MM-DD */
  publishedAt: string;
  /** 実際に改訂したときだけ入れる */
  updatedAt?: string;
  status: ColumnStatus;
  sources: ColumnSource[];
  /** 関連コラムの slug（2〜3件） */
  related: string[];
  relatedPages: ColumnRelatedPage[];
  /** 既存の使用許可済み素材のみ。無ければ画像なしで整った表示にする */
  image?: string;
  imageAlt?: string;
  /** manual＝人が書いた / auto＝自動生成 */
  generatedBy: 'manual' | 'auto';
}

export interface ColumnArticle extends ColumnMeta {
  /** Markdown 本文（レンダリング時に安全なノードへ変換する） */
  body: string;
}

/** 1ページあたりの記事数 */
export const COLUMN_PAGE_SIZE = 12;
