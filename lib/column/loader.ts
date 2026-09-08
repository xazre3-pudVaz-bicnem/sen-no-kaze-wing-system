/**
 * content/column/*.md を読み込んでコラム記事として提供する。
 * サーバー側でのみ実行する（fs を使うためクライアントから import しない）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, type FrontmatterValue } from './frontmatter.ts';
import { COLUMN_CATEGORIES, COLUMN_PAGE_SIZE, type ColumnArticle, type ColumnCategory, type ColumnSource } from './types.ts';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'column');

const asString = (v: FrontmatterValue | undefined): string => (typeof v === 'string' ? v : '');
const asStringArray = (v: FrontmatterValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const asObjectArray = (v: FrontmatterValue | undefined): Record<string, string>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, string> => typeof x === 'object' && x !== null) : [];

/** slug は英数字とハイフンだけ。パス経由の書き込み・読み出しを防ぐ */
export const isValidSlug = (slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function toArticle(fileName: string, raw: string): ColumnArticle | null {
  const { data, body } = parseFrontmatter(raw);
  const slug = asString(data.slug) || fileName.replace(/\.md$/, '');
  if (!isValidSlug(slug)) return null;

  const category = asString(data.category) as ColumnCategory;
  const publishedAt = asString(data.publishedAt);
  const status = asString(data.status) === 'draft' ? 'draft' : 'published';
  if (!asString(data.title) || !isIsoDate(publishedAt) || !COLUMN_CATEGORIES.includes(category)) return null;

  const sources: ColumnSource[] = asObjectArray(data.sources)
    .filter((s) => s.label && isIsoDate(s.checkedAt ?? ''))
    .map((s) => ({ label: s.label, url: s.url, checkedAt: s.checkedAt }));

  const updatedAt = asString(data.updatedAt);

  return {
    slug,
    title: asString(data.title),
    description: asString(data.description),
    category,
    publishedAt,
    updatedAt: isIsoDate(updatedAt) && updatedAt !== publishedAt ? updatedAt : undefined,
    status,
    sources,
    related: asStringArray(data.related),
    relatedPages: asObjectArray(data.relatedPages)
      .filter((p) => p.label && p.path?.startsWith('/'))
      .map((p) => ({ label: p.label, path: p.path })),
    image: asString(data.image) || undefined,
    imageAlt: asString(data.imageAlt) || undefined,
    generatedBy: asString(data.generatedBy) === 'auto' ? 'auto' : 'manual',
    body,
  };
}

/** 下書きも含めた全記事（管理・検証用） */
export function loadAllColumnArticles(): ColumnArticle[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => toArticle(f, fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8')))
    .filter((a): a is ColumnArticle => a !== null);
}

/** 公開済みだけを新しい順で返す。未来日付は公開しない */
export function getPublishedColumnArticles(now = new Date()): ColumnArticle[] {
  const today = now.toISOString().slice(0, 10);
  return loadAllColumnArticles()
    .filter((a) => a.status === 'published' && a.publishedAt <= today)
    .sort((a, b) => (a.publishedAt === b.publishedAt ? a.slug.localeCompare(b.slug) : b.publishedAt.localeCompare(a.publishedAt)));
}

export function getColumnArticle(slug: string): ColumnArticle | null {
  if (!isValidSlug(slug)) return null;
  return getPublishedColumnArticles().find((a) => a.slug === slug) ?? null;
}

export interface ColumnPage {
  articles: ColumnArticle[];
  page: number;
  totalPages: number;
  total: number;
}

export function getColumnPage(page: number): ColumnPage {
  const all = getPublishedColumnArticles();
  const totalPages = Math.max(1, Math.ceil(all.length / COLUMN_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    articles: all.slice((current - 1) * COLUMN_PAGE_SIZE, current * COLUMN_PAGE_SIZE),
    page: current,
    totalPages,
    total: all.length,
  };
}

/** 関連コラム。frontmatter の related を優先し、足りなければ同カテゴリーで補う */
export function getRelatedArticles(article: ColumnArticle, limit = 3): ColumnArticle[] {
  const all = getPublishedColumnArticles().filter((a) => a.slug !== article.slug);
  const picked: ColumnArticle[] = [];
  for (const slug of article.related) {
    const hit = all.find((a) => a.slug === slug);
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  for (const a of all) {
    if (picked.length >= limit) break;
    if (a.category === article.category && !picked.includes(a)) picked.push(a);
  }
  for (const a of all) {
    if (picked.length >= limit) break;
    if (!picked.includes(a)) picked.push(a);
  }
  return picked.slice(0, limit);
}
