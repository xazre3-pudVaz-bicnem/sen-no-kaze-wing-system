import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatYen } from '@/lib/domain/pricing';
import { StandardEstimateV25Selector, groupV25Selector } from '@/components/admin/standard-estimate-v25-selector';
import type { StandardEstimateWorkspaceEntry } from '@/lib/data/standard-estimate-workspace';

const definitions = [
  ['Wing', 'ホテル仕様', '3,640×4,550', '非防火'],
  ['Wing', 'ホテル仕様', '3,640×4,550', '防火'],
  ['Wing', '住居用', '3,640×4,550', '非防火'],
  ['Wing', '住居用', '3,640×4,550', '防火'],
  ['Wing', '事務所用', '3,640×4,550', '非防火'],
  ['Wing', '事務所用', '3,640×4,550', '防火'],
  ['BOX', 'ホテル仕様', '2,100×4,550', '非防火'],
  ['BOX', '水回りBOX', '2,100×4,550', '非防火'],
  ['BOX', '水回りBOX', '2,100×4,550', '防火'],
  ['Flat', '事務所用', '2,100×4,550', '非防火'],
] as const;

// Test values are deliberately distinct from actual prices: only data from the
// passed published Revision may be shown, never a hardcoded spec price.
const entries: StandardEstimateWorkspaceEntry[] = definitions.map(([model, purpose, size, fire], index) => ({
  masterId: 'master-' + index,
  name: model + ' ' + purpose + ' ' + fire,
  modelId: 'model-' + model,
  specCode: 'spec-' + index,
  identity: [model, purpose, size, fire].join(' / '),
  published: {
    revisionId: 'published-' + index,
    version: index + 1,
    total: 1_123_001 + index * 104_079,
    hasPor: [1, 2, 3, 6, 7, 8].includes(index),
    pricingModel: 'v2.5',
  },
  draft: index === 0 || index === 5
    ? { revisionId: 'draft-' + index, version: index + 2, lockVersion: 1, pricingModel: 'v2.5' }
    : null,
}));
const render = (rows: StandardEstimateWorkspaceEntry[] = entries, selectedId: string | null = 'master-0') =>
  renderToStaticMarkup(createElement(StandardEstimateV25Selector, { entries: rows, selectedId }));
const source = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('標準見積v2.5：コンパクトな仕様選択カード', () => {
  it('現在の10仕様をWing・BOX・Flatの区分内で漏れなく表示し、PC3列・タブレット2列・スマホ1列とする', () => {
    const html = render();
    expect(html.match(/data-testid="v25-selector-entry"/g)).toHaveLength(10);
    expect(html.match(/data-testid="v25-selector-product"/g)).toHaveLength(3);
    expect(html.match(/data-testid="v25-selector-grid"/g)).toHaveLength(3);
    expect(html.match(/grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3/g)).toHaveLength(3);
    expect(groupV25Selector(entries).map((group) => group.product)).toEqual(['Wing', 'BOX', 'Flat']);
    for (const entry of entries) {
      expect(html).toContain('master=' + entry.masterId);
      expect(html).toContain(entry.identity.split(' / ')[2]);
    }
    expect(html).not.toContain('max-w-[42rem]');
    expect(html).not.toContain('選択中</span>');
  });

  it('10仕様すべてで公開済みRevisionの保存済み税込総額だけを表示し、下書きの版番号と混同しない', () => {
    const html = render();
    for (const entry of entries) {
      expect(html).toContain(formatYen(entry.published!.total));
      expect(html).toContain('公開 第' + entry.published!.version + '版');
    }
    expect(html).toContain('下書き 第2版');
    expect(html).toContain('下書き 第7版');
    expect(html.match(/公開価格（税込）/g)).toHaveLength(10);
    expect(html.match(/＋別途見積/g)).toHaveLength(6);
    expect(html.match(/data-testid="v25-selector-published-total"/g)).toHaveLength(10);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('未公開は価格未設定と表示し、公開版の確定金額に見せかけない', () => {
    const unpublished = entries.map((entry, index) => index === 0 ? { ...entry, published: null } : entry);
    const html = render(unpublished);
    expect(html).toContain('公開価格未設定');
    expect(html).not.toContain(formatYen(entries[0].published!.total));
    expect(html.match(/data-testid="v25-selector-published-total"/g)).toHaveLength(9);
  });

  it('金額は既存読取経路で公開Revisionのtotalを取得し、独自計算・固定値を持ち込まない', () => {
    const workspace = source('lib/data/standard-estimate-workspace.ts');
    const selector = source('components/admin/standard-estimate-v25-selector.tsx');
    expect(workspace).toContain("revision.id === master.current_published_revision_id && revision.status === 'published'");
    expect(workspace).toContain('total: published.total');
    expect(selector).toContain('formatYen(entry.published.total)');
    expect(selector).toContain('entry.published.hasPor');
    expect(selector).not.toContain('computePricing');
    expect(selector).not.toContain('calculateTotal');
  });

  it('仕様切替の未保存確認と折り畳みを維持し、下の編集中版情報は残す', () => {
    const selector = source('components/admin/standard-estimate-v25-selector.tsx');
    const layout = source('components/admin/standard-estimate-workspace-layout.tsx');
    const page = source('app/admin/estimate-templates/page.tsx');
    expect(selector).toContain('data-testid="v25-wb-unsaved-position"');
    expect(selector).toContain('event.preventDefault()');
    expect(selector).toContain('window.confirm(');
    expect(layout).toContain('aria-expanded={selectorOpen}');
    expect(layout).toContain("selectorOpen ? 'min-w-0 w-full' : 'hidden'");
    expect(layout).toContain('selectedName && !selectorOpen');
    expect(page).toContain("workspace.revision.status === 'draft' ? 'warn' : 'success'");
    expect(page).toContain('第{workspace.revision.version}版');
    expect(page).toContain('版の詳細');
    expect(page).not.toContain('<h2 className="text-sm font-semibold text-slate-900">{selected.identity}</h2>');
  });
});
