import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/quote-management/page.tsx'), 'utf8');
const tabs = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/quote-management-tabs.tsx'), 'utf8');
const nav = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'), 'utf8');

describe('見積書管理の案件見積入口', () => {
  it('見積書管理の初期画面を案件見積一覧にする', () => {
    expect(nav).toContain("href: '/admin/quote-management'");
    expect(tabs).toContain('href="/admin/quote-management"');
    expect(page).toContain('案件見積一覧');
    expect(page).toContain('＋ 新しい案件見積');
  });

  it('Draftと正式見積を同じ一覧から開ける', () => {
    expect(page).toContain('store.listInitialQuoteDraftResumes(actor)');
    expect(page).toContain('store.listAllQuotes()');
    expect(page).toContain('/admin/quotes/drafts/');
    expect(page).toContain('tab=estimate#case-workspace');
    expect(page).toContain('下書き');
    expect(page).toContain('正式見積');
  });


  it('PCでは案件見積一覧を横スクロールなしで収める', () => {
    expect(page).toContain('min-w-[62rem]');
    expect(page).toContain('lg:min-w-0');
    expect(page).toContain('w-[31%]');
    expect(page).toContain('w-[14%]');
    expect(page).toContain('w-[12%]');
    expect(page).toContain('w-[10%]');
    expect(page).toContain('whitespace-nowrap px-2 py-2 align-middle text-xs text-muted');
  });

  it('シミュレーター標準は別タブのまま維持する', () => {
    expect(tabs).toContain('href="/admin/estimate-templates"');
    expect(tabs).toContain('シミュレーター標準');
  });
});
