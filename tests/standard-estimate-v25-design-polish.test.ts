import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardEstimateWorkspaceEntry } from '@/lib/data/standard-estimate-workspace';
import { StandardEstimateV25Selector } from '@/components/admin/standard-estimate-v25-selector';
import { StandardEstimateWorkspaceLayout } from '@/components/admin/standard-estimate-workspace-layout';
import { StandardEstimateV25AmountBreakdown } from '@/components/admin/standard-estimate-v25-amount-breakdown';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');
const workspaceData = read('lib/data/standard-estimate-workspace.ts');
const page = read('app/admin/estimate-templates/page.tsx');

const entries: StandardEstimateWorkspaceEntry[] = ['非防火', '防火'].map((fire, index) => ({
  masterId: 'master-' + index,
  modelId: 'model-wing',
  specCode: 'hotel-' + fire,
  name: 'Wing ホテル仕様 ' + fire,
  identity: `Wing / ホテル仕様 / 4550×3640 / ${fire}`,
  published: { revisionId: 'pub-' + index, version: 2, total: 100, hasPor: false, pricingModel: 'v2.5' },
  draft: index === 0 ? { revisionId: 'draft-1', version: 3, lockVersion: 4, pricingModel: 'v2.5' } : null,
}));

describe('標準見積v2.5 選択中の仕様／全仕様一覧の安全な切替', () => {
  it('選択中の機種・用途・サイズ・防火と下書き・公開版番号を保持し淡緑カードで強調', () => {
    const selector = renderToStaticMarkup(createElement(StandardEstimateV25Selector, { entries, selectedId: 'master-0' }));
    expect(selector.match(/data-testid="v25-selector-entry"/g)).toHaveLength(2);
    expect(selector).toContain('bg-emerald-50');
    expect(selector).toContain('border-emerald-800');
    expect(selector).toContain('aria-current="page"');
    expect(selector).toContain('公開中 第2版');
    expect(selector).toContain('下書き 第3版');
    expect(selector).toContain('href="/admin/estimate-templates?master=master-1"');
    expect(selector).toContain('非防火');
    expect(selector).toContain('防火');
    const layout = renderToStaticMarkup(createElement(StandardEstimateWorkspaceLayout, {
      selectedName: entries[0].identity,
      sidebar: createElement('aside', null, '全仕様'),
    }, createElement('main', null, 'Excel風明細')));
    expect(layout).toContain('data-testid="v25-selected-spec-summary"');
    expect(layout).toContain('仕様を変更');
    expect(layout).toContain(entries[0].identity.replaceAll('×', '×'));
    expect(layout).toContain('Excel風明細');
    expect(layout).toContain('aria-expanded="false"');
  });

  it('仕様変更リンクは未保存の下書き入力時だけ確認し、取消時は遷移を防ぐ', () => {
    const selector = read('components/admin/standard-estimate-v25-selector.tsx');
    expect(selector).toContain("'use client'");
    expect(selector).toContain('if (!active && document.querySelector(\'[data-testid="v25-wb-unsaved-position"]\')');
    expect(selector).toContain('window.confirm(');
    expect(selector).toContain('event.preventDefault()');
    expect(workbench).toContain('!readOnly && dirty && <p');
    expect(workbench).toContain('data-testid="v25-wb-unsaved-position"');
  });
});

describe('標準見積v2.5 設定・金額・本体参照・位置表示', () => {
  it('率の上下限・直接入力を維持し、調整理由の幅と列設定の横並びを維持', () => {
    expect(workbench).toContain('v25StepPercent(percents[key], 1, key) === percents[key]');
    expect(workbench).toContain('v25StepPercent(percents[key], -1, key) === percents[key]');
    expect(workbench).toContain('stepRate(key, event.key === \'ArrowUp\' ? 1 : -1)');
    expect(workbench).toContain('min-w-[13rem] flex-[2_1_16rem]');
    expect(workbench).toContain('data-testid="v25-wb-compact-settings"');
    expect(workbench).toContain('<V25ColumnDisplayMenu');
    expect(workbench).toContain('flex flex-wrap items-center gap-x-2.5 gap-y-1.5');
  });

  it('保存中と未保存の保護・公開確認を変えず、操作を2群に整理', () => {
    expect(workbench).toContain('data-testid="v25-wb-action-priorities"');
    expect(workbench).toContain('disabled={pending || !dirty || positionInputActive}');
    expect(workbench).toContain('disabled={pending || dirty || positionInputActive}');
    expect(workbench).toContain('disabled={pending || blockers.length > 0 || positionInputActive}');
    expect(workbench).toContain('dialogTitle="この内容で公開しますか？"');
    expect(workbench).toContain('saveStandardEstimateV25DraftAction');
    expect(workbench).toContain('publishStandardEstimateV25RevisionAction');
    expect(workbench).toContain('buildV25SavePayload(v25WithRowOrder(toSave, displayRefs))');
  });

  it('参照中の本体マスターの固定版だけを表示し、未取得時は安全な一覧へ案内', () => {
    expect(workspaceData).toContain("'id, version, status, base_master_revision_id,");
    expect(workspaceData).toContain(".from('base_master_revisions')");
    expect(workspaceData).toContain(".eq('id', revision.base_master_revision_id)");
    expect(workspaceData).toContain("typeof baseReferenceResult.data.version === 'number'");
    expect(workbench).toContain('baseMasterReference ? (');
    expect(workbench).toContain('baseMasterReference.revisionVersion');
    expect(workbench).toContain('data-testid="v25-wb-base-master-link"');
    expect(workbench).toContain('data-testid="v25-wb-base-master-fallback"');
    expect(workbench).toContain('参照専用');
    expect(page).toContain('baseMasterReference={workspace.v25.baseMasterReference}');
  });

  it('サッシと照明は設定リンクを持ち、位置名だけ編集可能・候補を独立表示', () => {
    expect(workbench).toContain("candidate?.categoryCode === 'sash'");
    expect(workbench).toContain("candidate?.categoryCode === 'lighting'");
    expect(workbench).toContain('{(isSash || isLighting) && positionAllowed && (');
    expect(workbench).toContain('data-testid="v25-wb-slot-position-toggle"');
    expect(workbench).toContain('data-testid="v25-wb-position-summary"');
    expect(workbench).toContain('data-testid="v25-wb-position-not-set"');
    expect(workbench).toContain('設置位置：');
    expect(workbench).toContain('変更候補：');
    expect(workbench).toContain("slot.selectable_option_ids.length > 0 ? `${slot.selectable_option_ids.length}件` : 'なし'");
    expect(workbench).toContain('data-testid="v25-wb-inline-position-editor"');
    expect(workbench).toContain('renameV25Position(state, slot.key, label');
    expect(workbench).toContain('onCancel={() => setPositionLabelEditor(null)}');
    expect(workbench).toContain('canUsePositionSlot(candidate.categoryCode)');
  });

  it('試算と保存済みDB金額を明確に区別し、警告・粗利未算定と明細末尾合計を維持', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25AmountBreakdown, {
      result: null, savedTotal: 123456, unpricedCount: 1, incompleteCostCount: 1,
    }));
    expect(html).toContain('data-testid="v25-amount-breakdown-trial-row"');
    expect(html).toContain('data-testid="v25-amount-breakdown-saved-row"');
    expect(html).toContain('保存済み税込合計（DB）');
    expect(html).toContain('売価未入力 1 件、商品原価未設定 1 件');
    expect(html).toContain('未算定');
    expect(workbench).toContain('data-testid="v25-wb-total"');
    expect(workbench).toContain('保存済み {savedTotal !== null');
    expect(workbench).toContain('bg-lime-100');
    expect(workbench).toContain('data-testid="v25-work-item-heading"');
    expect(workbench).toContain('data-testid="v25-wb-change-work-group"');
    expect(workbench).toContain('setJumpToKey({ key: groupEditor.lineKey })');
  });
});
