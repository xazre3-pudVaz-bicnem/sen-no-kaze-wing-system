import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlashMessages } from '@/components/admin/ui';

describe('原価記録失敗の案内', () => {
  it('保存成功後の警告と、対象確認を促す復旧画面へのリンクを表示する', () => {
    const html = renderToStaticMarkup(createElement(FlashMessages, { sp: {cost_warning:'商品は保存しましたが、原価の Version を記録できませんでした。'} }));
    expect(html).toContain('商品は保存しましたが、原価の Version を記録できませんでした。');
    expect(html).toContain('対象と金額を確認し、必要な項目だけを選んでください。');
    expect(html).toContain('href="/admin/options/cost-import"');
  });
  it('警告がなければ復旧リンクを表示しない', () => {
    expect(renderToStaticMarkup(createElement(FlashMessages, { sp: {saved:'1'} }))).not.toContain('/admin/options/cost-import');
  });
});

import { registeredOptionLedgerUrl } from '@/lib/domain/registered-option-save-result';
import { readFileSync } from 'node:fs';

it('保存成功と記録失敗を移動先で区別し、エラー詳細をURLに含めない', () => {
  const normal = new URL(registeredOptionLedgerUrl('id & 1', {}), 'https://wing.invalid');
  expect(normal.searchParams.get('updated_option')).toBe('id & 1');
  expect(normal.searchParams.has('cost_recording_failed')).toBe(false);
  const failed = new URL(registeredOptionLedgerUrl('id & 1', { costRecordingFailed: true }), 'https://wing.invalid');
  expect(failed.searchParams.get('cost_recording_failed')).toBe('1');
  const html = renderToStaticMarkup(createElement(FlashMessages, { sp: Object.fromEntries(failed.searchParams) }));
  expect(html).toContain('商品は保存しましたが、原価の Version を記録できませんでした');
  expect(html).toContain('記録済みの項目がある場合もあります');
  expect(html).toContain('href="/admin/options/cost-import"');
  const edit = readFileSync('components/admin/registered-option-edit-flow.tsx', 'utf8');
  const ledger = readFileSync('app/admin/ledger/page.tsx', 'utf8');
  expect(edit).toContain('if (result.ok)');
  expect(edit).toContain('router.push(registeredOptionLedgerUrl(option.id, result))');
  expect(ledger).toContain('<FlashMessages sp={sp} />');
});

it('公開後に戻る各見積テンプレート画面は共通の警告を表示する', () => {
  const detail = readFileSync('app/admin/estimate-templates/[id]/page.tsx', 'utf8');
  const legacy = readFileSync('app/admin/estimate-templates/legacy/page.tsx', 'utf8');
  expect(detail).toContain('<FlashMessages sp={sp} />');
  expect(legacy.match(/<FlashMessages sp=\{sp\} \/>/g)).toHaveLength(3);
});
