import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const page = fs.readFileSync(path.join(root, 'app/admin/quotes/page.tsx'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'components/admin/case-list-column-menu.tsx'), 'utf8');

describe('案件一覧のExcel風列ソート・絞り込み', () => {
  it('フェーズ・商品モデル・見積額・担当代理店の列メニューを表示する', () => {
    expect(page).toContain("import { CaseListColumnMenu } from '@/components/admin/case-list-column-menu'");
    for (const label of ['担当代理店', '現在フェーズ', '商品モデル', '見積額']) {
      expect(page).toContain(`label=\"${label}\"`);
    }
    expect(menu).toContain('並び替え');
    expect(menu).toContain('昇順');
    expect(menu).toContain('降順');
    expect(menu).toContain('すべて');
  });

  it('本部一覧は案件・顧客の直後に担当代理店を置き、担当者を別列にする', () => {
    const adminHeader = page.slice(
      page.indexOf('<h2 className="text-sm font-semibold">案件一覧</h2>'),
      page.indexOf('<tbody>', page.indexOf('<h2 className="text-sm font-semibold">案件一覧</h2>'))
    );
    expect(adminHeader.indexOf('案件・顧客')).toBeLessThan(adminHeader.indexOf('label="担当代理店"'));
    expect(adminHeader.indexOf('label="担当代理店"')).toBeLessThan(adminHeader.indexOf('label="現在フェーズ"'));
    expect(adminHeader).toContain('>担当者</th>');
    expect(page).toContain('dealer?.company_name ? dealer.company_name');
    expect(page).toContain('dealer?.full_name ?? <span className="text-muted">未登録</span>');
  });

  it('列条件を既存の検索条件と併用し、案件選択後も保持する', () => {
    expect(page).toContain("const LIST_PARAM_KEYS = ['q', 'status', 'dealer', 'pref', 'city', 'phase', 'model', 'sort'] as const;");
    expect(page).toContain("const phaseFilter = sp.phase ?? '';");
    expect(page).toContain("const modelFilter = sp.model ?? '';");
    expect(page).toContain("const sortMode = sp.sort ?? '';");
    expect(page).toContain('if (phaseFilter && phaseLabel !== phaseFilter) return false;');
    expect(page).toContain('if (modelFilter && modelName !== modelFilter) return false;');
    expect(page).toContain('name="phase" value={phaseFilter}');
    expect(page).toContain('name="model" value={modelFilter}');
    expect(page).toContain('name="sort" value={sortMode}');
  });

  it('見積未発行を見積額ソートの末尾に置き、既存金額値自体は変更しない', () => {
    expect(page).toContain("sortMode === 'amount-asc' || sortMode === 'amount-desc'");
    expect(page).toContain('if (!quoteA && quoteB) return 1;');
    expect(page).toContain('if (quoteA && !quoteB) return -1;');
    expect(page).toContain("sortMode === 'amount-asc' ? quoteA.total - quoteB.total : quoteB.total - quoteA.total");
    expect(page).toContain('{quote ? formatYen(quote.total) : \'—\'}');
  });

  it('棟数と収支の数値は画面確認用サンプルだけに限定する', () => {
    expect(page).toContain("const CASE_LIST_SAMPLE_QUOTE_NO = 'Q202609-0003';");
    expect(page).toContain('const CASE_LIST_SAMPLE_UNIT_COUNT = 2;');
    expect(page).toContain('const CASE_LIST_SAMPLE_COST = 3_000_000;');
    expect(page).toContain('画面確認用サンプル');
    expect(page).toContain('正式値ではありません');
    expect(page).toContain('data-testid="case-sample-finance"');
    expect(page).toContain("sampleDisplay ? `${sampleDisplay.unitCount}棟` : '—'");
    expect(page).toContain('原価（例）');
    expect(page).toContain('利益（例）');
    expect(page).toContain('利益率（例）');
  });

  it('代理店向け担当案件一覧には今回の列メニューを持ち込まない', () => {
    const dealerBlock = page.slice(page.indexOf("if (actor.role !== 'admin') {"), page.indexOf('const [requests, quotes, dealers, initialDraftResumes]'));
    expect(dealerBlock).not.toContain('<CaseListColumnMenu');
  });
});
