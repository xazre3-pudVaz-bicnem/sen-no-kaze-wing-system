import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const client = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-client.tsx'), 'utf8');
const dismiss = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-ledger-overlay-dismiss.tsx'), 'utf8');

describe('商品台帳の商品詳細レスポンシブ表示', () => {
  it('1280px未満では一覧下へ押し出さず画面上の詳細オーバーレイとして表示する', () => {
    expect(page).toContain('@media (max-width: 1279px)');
    expect(page).toContain('[data-testid="ledger-product-detail-pane"]');
    expect(page).toContain('position: fixed;');
    expect(page).toContain('inset: 0;');
    expect(page).toContain('z-index: 80;');
    expect(page).toContain('height: 100dvh;');
    expect(page).toContain('padding-left: max(0px, calc(100vw - 46rem));');
    expect(page).toContain('background: rgb(0 0 0 / 0.35);');
    expect(page).toContain('overflow-y: auto;');
    expect(page).toContain('overscroll-behavior: contain;');
  });

  it('スマホでは詳細を全画面表示し、PC広幅では既存の右側詳細ペインを維持する', () => {
    expect(page).toContain('@media (max-width: 639px)');
    expect(page).toContain('padding-left: 0;');
    expect(client).toContain('xl:grid-cols-[minmax(0,1.35fr)_minmax(26rem,0.65fr)]');
    expect(client).toContain('xl:sticky xl:top-4');
    expect(client).toContain('商品詳細を閉じる');
    expect(client).toContain('前の商品');
    expect(client).toContain('次の商品');
    expect(client).toContain('商品情報を編集');
  });

  it('狭い画面では半透明の枠外を押すと詳細を閉じ、詳細内クリックや広幅PCでは閉じない', () => {
    expect(page).toContain("import { ProductLedgerOverlayDismiss } from '@/components/admin/product-ledger-overlay-dismiss'");
    expect(page).toContain('<ProductLedgerOverlayDismiss />');
    expect(dismiss).toContain("window.matchMedia('(min-width: 1280px)').matches");
    expect(dismiss).toContain("target.closest<HTMLElement>('[data-testid=\"ledger-product-detail-pane\"]')");
    expect(dismiss).toContain('if (!pane || target !== pane) return;');
    expect(dismiss).toContain("button[aria-label=\"商品詳細を閉じる\"]");
    expect(dismiss).toContain("document.addEventListener('pointerdown', handlePointerDown)");
    expect(dismiss).toContain("document.removeEventListener('pointerdown', handlePointerDown)");
  });
});
