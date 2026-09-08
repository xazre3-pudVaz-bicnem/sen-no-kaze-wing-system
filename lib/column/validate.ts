/**
 * 記事の検証。自動生成スクリプトと vitest の両方から使う。
 * 「AI の自己採点で合格にしない」ため、機械的に確認できる条件だけをここで判定する。
 */
import { bodyLength, normalizeHref, parseColumnMarkdown } from './markdown.ts';
import { isValidSlug } from './loader.ts';
import { COLUMN_CATEGORIES, type ColumnArticle } from './types.ts';

/** 断定・誇大表現の禁止パターン。活用形も捕まえるため正規表現で持つ */
export const BANNED_PATTERNS: { label: string; re: RegExp }[] = [
  { label: '必ず儲かる系', re: /必ず[^。]{0,6}儲か|確実に[^。]{0,6}儲か|絶対に[^。]{0,6}儲か/ },
  { label: '順位の保証', re: /絶対に[^。]{0,6}上位表示|必ず[^。]{0,6}上位表示/ },
  { label: '安全性の断定', re: /100[%％][^。]{0,4}安全|絶対に[^。]{0,4}安全|絶対に[^。]{0,4}安心/ },
  { label: '節税の断定', re: /必ず[^。]{0,4}節税|絶対に[^。]{0,4}節税/ },
  { label: '最上級表現', re: /日本一|業界No.?1|業界ナンバーワン|最安値|完全無料/ },
];

/** 後方互換のための文字列一覧（テスト・ドキュメント用） */
export const BANNED_PHRASES = BANNED_PATTERNS.map((p) => p.label);

/**
 * 一次資料の確認なしに断定してはいけない話題。
 * 本文に含まれる場合は下書き扱いにして人の確認へ回す。
 */
export const REVIEW_REQUIRED_TOPICS = ['建築確認', '用途地域', '旅館業', '民泊', '補助金', '助成金', '減価償却', '固定資産税', '利回り', '節税'];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** 人の確認が必要（=自動公開せず draft にする）と判断した理由 */
  reviewReasons: string[];
}

export function validateArticle(article: ColumnArticle, existing: ColumnArticle[] = []): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reviewReasons: string[] = [];

  if (!isValidSlug(article.slug)) errors.push(`slug が不正: ${article.slug}`);
  if (existing.some((a) => a.slug === article.slug)) errors.push(`slug が既存記事と重複: ${article.slug}`);
  if (!article.title.trim()) errors.push('title が空');
  if (article.title.length > 60) warnings.push(`title が長い（${article.title.length}文字）`);
  if (!article.description.trim()) errors.push('description が空');
  if (article.description.length > 120) warnings.push(`description が120文字を超える（${article.description.length}文字）`);
  if (!COLUMN_CATEGORIES.includes(article.category)) errors.push(`category が不正: ${article.category}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(article.publishedAt)) errors.push('publishedAt が YYYY-MM-DD でない');

  // 出典（最低1件・確認日つき）
  if (article.sources.length === 0) errors.push('sources が空（根拠資料が無い記事は公開しない）');
  for (const s of article.sources) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt)) errors.push(`sources.checkedAt が不正: ${s.label}`);
    if (s.url && !normalizeHref(s.url)) errors.push(`sources.url が許可外: ${s.url}`);
  }

  // 本文
  const len = bodyLength(article.body);
  if (len < 900) errors.push(`本文が短すぎる（${len}文字）`);
  if (len > 4000) warnings.push(`本文が長い（${len}文字）`);

  const nodes = parseColumnMarkdown(article.body);
  const h2 = nodes.filter((n) => n.type === 'heading' && n.level === 2).length;
  if (h2 < 3) errors.push(`H2 見出しが少ない（${h2}個）`);
  if (article.body.includes('<script') || /<[a-z]+\s+on[a-z]+=/i.test(article.body)) errors.push('本文にスクリプト/イベント属性が含まれる');

  // 禁止表現（タイトルと本文の両方を見る。活用形も拾えるよう正規表現で判定）
  const haystack = `${article.title}\n${article.body}`;
  for (const p of BANNED_PATTERNS) {
    if (p.re.test(haystack)) errors.push(`禁止表現（${p.label}）`);
  }

  // リンク検証
  for (const node of nodes) {
    const inlines = node.type === 'paragraph' || node.type === 'quote' ? node.children : node.type === 'list' ? node.items.flat() : [];
    for (const inline of inlines) {
      if (inline.type === 'link' && !normalizeHref(inline.href)) errors.push(`リンク先が許可外: ${inline.href}`);
    }
  }
  for (const p of article.relatedPages) {
    if (!normalizeHref(p.path)) errors.push(`関連ページのパスが不正: ${p.path}`);
  }
  if (article.image && !article.image.startsWith('/images/')) errors.push(`画像パスが不正: ${article.image}`);

  // 重複テーマの検出（タイトルの文字集合が既存と8割以上一致したら弾く）
  for (const a of existing) {
    if (similarity(a.title, article.title) >= 0.8) errors.push(`既存記事とテーマが重複: ${a.slug}`);
  }

  // 専門判断が必要な話題
  for (const t of REVIEW_REQUIRED_TOPICS) {
    if (article.body.includes(t)) reviewReasons.push(t);
  }

  return { ok: errors.length === 0, errors, warnings, reviewReasons };
}

/** タイトルの近さ（2-gram の Jaccard 係数） */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/[\s　]/g, '');
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}
