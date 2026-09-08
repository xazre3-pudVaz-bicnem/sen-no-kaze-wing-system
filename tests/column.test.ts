import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from '@/lib/column/frontmatter';
import { bodyLength, normalizeHref, parseColumnMarkdown, tocItems } from '@/lib/column/markdown';
import { getColumnArticle, getPublishedColumnArticles, isValidSlug, loadAllColumnArticles } from '@/lib/column/loader';
import { similarity, validateArticle } from '@/lib/column/validate';
import type { ColumnArticle } from '@/lib/column/types';

const baseArticle = (over: Partial<ColumnArticle> = {}): ColumnArticle => ({
  slug: 'test-article',
  title: 'テスト記事のタイトル',
  description: 'テスト用の説明文です。',
  category: '基礎知識',
  publishedAt: '2026-09-05',
  status: 'published',
  sources: [{ label: '社内資料', checkedAt: '2026-09-05' }],
  related: [],
  relatedPages: [{ label: 'お問い合わせ', path: '/contact' }],
  generatedBy: 'auto',
  body: ['## 見出し1', 'あ'.repeat(400), '## 見出し2', 'い'.repeat(400), '## 見出し3', 'う'.repeat(300)].join('\n\n'),
  ...over,
});

describe('frontmatter', () => {
  it('文字列・配列・オブジェクト配列を読み取る', () => {
    const raw = `---\nslug: abc\nrelated: [a, b]\nsources:\n  - label: 資料A\n    checkedAt: 2026-09-05\n---\n\n本文です。`;
    const { data, body } = parseFrontmatter(raw);
    expect(data.slug).toBe('abc');
    expect(data.related).toEqual(['a', 'b']);
    expect(data.sources).toEqual([{ label: '資料A', checkedAt: '2026-09-05' }]);
    expect(body).toBe('本文です。');
  });

  it('書き出したものを読み戻せる', () => {
    const md = stringifyFrontmatter({ slug: 'x-y', title: 'タイトル', related: ['a'], sources: [{ label: 'A', checkedAt: '2026-09-05' }] }, '## 見出し\n\n本文');
    const { data, body } = parseFrontmatter(md);
    expect(data.slug).toBe('x-y');
    expect(data.sources).toEqual([{ label: 'A', checkedAt: '2026-09-05' }]);
    expect(body).toContain('## 見出し');
  });
});

describe('Markdown の解析（生成物を安全に描画する）', () => {
  it('見出し・段落・箇条書き・表を解釈する', () => {
    const nodes = parseColumnMarkdown('## 見出し\n\n段落です。\n\n- 項目1\n- 項目2\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    expect(tocItems(nodes)).toHaveLength(1);
  });

  it('HTML タグは描画対象にしない', () => {
    const nodes = parseColumnMarkdown('<script>alert(1)</script>危険ではない文章');
    const text = JSON.stringify(nodes);
    expect(text).not.toContain('script');
    expect(text).toContain('危険ではない文章');
  });

  it('許可されないリンク先はリンクにしない', () => {
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('http://example.com')).toBeNull();
    expect(normalizeHref('https://example.com')).toBeNull();
    expect(normalizeHref('/admin/quotes')).toBeNull();
    expect(normalizeHref('/contact')).toEqual({ href: '/contact', external: false });
  });

  it('不正なリンクは素のテキストとして残す', () => {
    const nodes = parseColumnMarkdown('[危険](javascript:alert(1)) を含む段落');
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('javascript');
    expect(json).toContain('危険');
  });
});

describe('記事の検証', () => {
  it('条件を満たす記事は合格する', () => {
    expect(validateArticle(baseArticle()).ok).toBe(true);
  });

  it('出典が無い記事は公開しない', () => {
    const r = validateArticle(baseArticle({ sources: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('sources');
  });

  it('禁止表現があれば不合格', () => {
    const r = validateArticle(baseArticle({ body: baseArticle().body + '\n\nこの方法なら必ず儲かります。' }));
    expect(r.ok).toBe(false);
  });

  it('本文が短すぎると不合格', () => {
    expect(validateArticle(baseArticle({ body: '## 見出し\n\n短い本文' })).ok).toBe(false);
  });

  it('slug が既存と重複したら不合格', () => {
    const existing = [baseArticle({ slug: 'test-article', title: '別のタイトルにしておく' })];
    expect(validateArticle(baseArticle(), existing).ok).toBe(false);
  });

  it('似たタイトルの記事は重複として弾く', () => {
    const existing = [baseArticle({ slug: 'other-article' })];
    expect(validateArticle(baseArticle({ slug: 'new-article' }), existing).ok).toBe(false);
    expect(similarity('木造コンテナの選び方', '木造コンテナの選び方')).toBe(1);
  });

  it('専門判断が必要な話題は要確認として報告する', () => {
    const r = validateArticle(baseArticle({ body: baseArticle().body + '\n\n旅館業の許可について触れます。' }));
    expect(r.reviewReasons).toContain('旅館業');
  });

  it('許可外リンクを含む本文は不合格', () => {
    const r = validateArticle(baseArticle({ relatedPages: [{ label: '管理', path: '/admin' }] }));
    expect(r.ok).toBe(false);
  });
});

describe('記事の読み込み', () => {
  it('slug の形式を検証する', () => {
    expect(isValidSlug('wing-check-before-considering')).toBe(true);
    expect(isValidSlug('../../etc/passwd')).toBe(false);
    expect(isValidSlug('Wing_Check')).toBe(false);
  });

  it('初期記事が公開されている', () => {
    const all = getPublishedColumnArticles();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.map((a) => a.slug)).toContain('wing-check-before-considering');
  });

  it('公開記事は出典と本文の条件を満たしている', () => {
    for (const a of getPublishedColumnArticles()) {
      const others = getPublishedColumnArticles().filter((x) => x.slug !== a.slug);
      const r = validateArticle(a, others.filter((x) => x.title !== a.title));
      expect(r.errors, `${a.slug}: ${r.errors.join(' / ')}`).toEqual([]);
      expect(bodyLength(a.body)).toBeGreaterThan(900);
    }
  });

  it('下書きは公開一覧に出ない', () => {
    const drafts = loadAllColumnArticles().filter((a) => a.status === 'draft');
    const published = getPublishedColumnArticles().map((a) => a.slug);
    for (const d of drafts) expect(published).not.toContain(d.slug);
  });

  it('存在しない slug は null を返す', () => {
    expect(getColumnArticle('does-not-exist')).toBeNull();
    expect(getColumnArticle('../secret')).toBeNull();
  });
});
