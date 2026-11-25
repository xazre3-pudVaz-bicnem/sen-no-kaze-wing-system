import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardEstimateWorkspaceEntry } from '@/lib/data/standard-estimate-workspace';
import { StandardEstimateV25Selector, groupV25Selector, v25SelectorRow } from '@/components/admin/standard-estimate-v25-selector';

const entry = (key: string, identity: string, published = true, draft = false): StandardEstimateWorkspaceEntry => ({
  masterId: key, modelId: key, specCode: key, name: identity, identity,
  published: published ? { revisionId: `r-${key}`, version: 2, total: 100, hasPor: false, pricingModel: 'v2.5' } : null,
  draft: draft ? { revisionId: `d-${key}`, version: 3, lockVersion: 1, pricingModel: 'v2.5' } : null,
});
const entries = [
  entry('f1', 'Flat / 事務所仕様 / 4550×2100 / 非防火', false, true),
  entry('b2', 'BOX / 住居仕様 / 5460×2100 / 防火', true, true),
  entry('w2', 'Wing / ホテル仕様 / 4550×3640 / 防火'),
  entry('w1', 'Wing / ホテル仕様 / 4550×3640 / 非防火', true, true),
  entry('b1', 'BOX / 住居仕様 / 5460×2100 / 非防火'),
  entry('b3', 'BOX / 水回りBOX / 6370×2100 / 非防火'),
  entry('w3', 'Wing / 住居仕様 / 4550×3640 / 非防火'),
  entry('w4', 'Wing / 事務所仕様 / 4550×3640 / 非防火'),
  entry('b4', 'BOX / ホテル仕様 / 5460×2100 / 非防火'),
  entry('f2', 'Flat / 事務所仕様 / 4550×2100 / 防火'),
];

describe('v2.5 標準見積仕様一覧（全件を保持する表示専用整理）', () => {
  it('Wing → BOX → Flat、用途とサイズ、非防火 → 防火で整列', () => {
    const original = JSON.stringify(entries);
    const groups = groupV25Selector(entries);
    expect(groups.map(g => g.product)).toEqual(['Wing', 'BOX', 'Flat']);
    expect(groups[0].sections.map(s => s.purpose)).toEqual(['ホテル仕様', '住居仕様', '事務所仕様']);
    expect(groups[1].sections.map(s => s.purpose)).toEqual(['ホテル仕様', '住居仕様', '水回りBOX']);
    expect(groups[0].sections[0].sizes[0].rows.map(r => r.fire)).toEqual(['非防火', '防火']);
    expect(groups.flatMap(g => g.sections.flatMap(s => s.sizes.flatMap(size => size.rows)))
      .map(r => r.entry.masterId).sort()).toEqual(entries.map(e => e.masterId).sort());
    expect(JSON.stringify(entries)).toBe(original);
  });

  it('未知形式の仕様は省略せずその他扱いで表示し、データを変更しない', () => {
    const unknown = entry('old', '旧形式の標準見積', false, false);
    expect(v25SelectorRow(unknown).purpose).toBe(unknown.identity);
    const grouped = groupV25Selector([...entries, unknown]);
    expect(grouped.flatMap(g => g.sections.flatMap(s => s.sizes.flatMap(i => i.rows)))
      .some(r => r.entry.masterId === 'old')).toBe(true);
  });

  it('仕様選択・公開版・下書きの状態を各カードに表示し、サイズを重複しない', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25Selector, {
      entries, selectedId: 'w1',
    }));
    expect((html.match(/data-testid="v25-selector-entry"/g) ?? [])).toHaveLength(10);
    expect((html.match(/data-testid="v25-selector-product"/g) ?? [])).toHaveLength(3);
    expect((html.match(/>4550×3640<\/span>/g) ?? [])).toHaveLength(1); // Wing内の同寸法はグループ見出しに1回だけ
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('選択中'); // 現在の仕様を明確にする
    expect(html).toContain('公開 第2版');
    expect(html).toContain('下書き 第3版');
    expect(html).toContain('未公開');
    expect(html).toContain('href="/admin/estimate-templates?master=w1"');
    expect(html).toContain('data-testid="v25-selector-list"');
    expect(html).toContain('max-h-[22rem]');
    expect(html).toContain('公開価格（税込）');
    expect(html).toContain('公開価格未設定');
    expect(html).not.toContain('data-testid="v25-selector-size"');
  });

  it('空欄も既存の案内を保つ', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25Selector, { entries: [], selectedId: null }));
    expect(html).toContain('標準見積がまだありません');
    expect(html).toContain('data-testid="standard-estimate-selector"');
  });
});
