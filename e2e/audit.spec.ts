import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN_EMAIL as ADMIN,
  DEALER_EMAIL as DEALER,
  ensureAccount,
  ensureDealerFreeProduct,
  logout,
  register,
  requestQuoteAsCustomer,
  signInOrRegister as signIn,
  uniqueEmail,
} from './helpers';

/**
 * 全画面の一括点検。
 * 横スクロール・コンソールエラー・見出し構造・画像の破損・要素のはみ出しを機械的に洗う。
 * 個別の機能は他の spec が見ているので、ここは「崩れ」だけを見る。
 */

interface Finding {
  page: string;
  width: number;
  problem: string;
}

const findings: Finding[] = [];

async function inspect(page: Page, label: string, width: number) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const res = await page.goto(label, { waitUntil: 'domcontentloaded' });
  if (!res || res.status() >= 400) {
    findings.push({ page: label, width, problem: `HTTP ${res?.status()}` });
    return;
  }
  await page.waitForLoadState('load').catch(() => {});

  const report = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;

    // 1. 横スクロール
    const overflow = doc.scrollWidth - doc.clientWidth;
    if (overflow > 1) out.push(`横スクロール ${overflow}px`);

    // 2. ビューポートからはみ出している要素
    const vw = doc.clientWidth;
    const wide: string[] = [];
    // 横スクロール領域や overflow:hidden の内側に収まっているものは設計どおりなので除外する
    const clipped = (el: HTMLElement) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return;
      if (clipped(el)) return;
      if (r.right > vw + 2 || r.left < -2) {
        const id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : '');
        if (wide.length < 4 && !wide.includes(id)) wide.push(id);
      }
    });
    if (wide.length) out.push(`はみ出し: ${wide.join(' / ')}`);

    // 3. 見出し構造
    const h1 = document.querySelectorAll('main h1, h1');
    if (h1.length === 0) out.push('h1 がない');
    if (h1.length > 1) out.push(`h1 が ${h1.length} 個`);

    // 4. 代替テキストのない画像
    const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt'));
    if (noAlt.length) out.push(`alt 属性のない img が ${noAlt.length} 個`);

    // 5. 読み込みに失敗した画像
    const broken = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0);
    if (broken.length) out.push(`表示できない画像 ${broken.length} 個: ${broken.slice(0, 2).map((i) => i.getAttribute('src')).join(', ')}`);

    // 6. 空のリンク・ボタン（読み上げできない操作）
    const nameless = [...document.querySelectorAll('a, button')].filter((el) => {
      const t = (el.textContent ?? '').trim();
      return !t && !el.getAttribute('aria-label') && !el.getAttribute('title') && (el as HTMLElement).offsetParent !== null;
    });
    if (nameless.length) out.push(`名前のないリンク/ボタン ${nameless.length} 個`);

    return out;
  });

  for (const problem of report) findings.push({ page: label, width, problem });
  const noisy = errors.filter((e) => !/favicon|DevTools|net::ERR_ABORTED|_next\/hmr|WebSocket|Fast Refresh|scroll-behavior|Largest Contentful Paint/i.test(e));
  for (const e of noisy.slice(0, 3)) findings.push({ page: label, width, problem: `コンソール: ${e.slice(0, 160)}` });
}

const PUBLIC_PAGES = [
  '/',
  '/products',
  '/products/wing-01',
  '/products/box',
  '/products/flat',
  '/simulator/wing-01',
  '/simulator/box',
  '/simulator/flat',
  '/dealers',
  '/news',
  '/contact',
  '/sct',
  '/privacy',
  '/terms',
  '/login',
  '/register',
  '/reset-password',
];

const ADMIN_PAGES = [
  '/admin',
  '/admin/notifications',
  '/admin/ledger',
  '/admin/free-products',
  '/admin/models',
  '/admin/categories',
  '/admin/options',
  '/admin/options/new',
  '/admin/preview-rules',
  '/admin/customers',
  '/admin/configurations',
  '/admin/quotes',
  '/admin/contacts',
  '/admin/audit',
  '/admin/manual',
];

test.describe.configure({ mode: 'serial' });

test.describe('全画面の点検', () => {
  test('公開ページ（PC 1440 / SP 390）', async ({ browser }) => {
    for (const width of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      for (const p of PUBLIC_PAGES) await inspect(page, p, width);
      await ctx.close();
    }
  });

  test('会員ページ（マイページ・見積）', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const email = uniqueEmail('audit');
    const { quoteId, configId } = await requestQuoteAsCustomer(page, email, '点検用の仕様');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of ['/mypage', '/mypage/profile', `/mypage/quotes/${quoteId}`, `/mypage/configurations/${configId}/request-quote`]) {
        await inspect(page, p, width);
      }
    }
    await ctx.close();
  });

  test('管理画面（本部）', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page, ADMIN, '/admin', '管理者');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of ADMIN_PAGES) await inspect(page, p, width);
    }
    await ctx.close();
  });

  test('管理画面（代理店）', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await ensureAccount(page, DEALER, '代理店 担当');
    await ensureDealerFreeProduct(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of ['/admin', '/admin/notifications', '/admin/ledger', '/admin/free-products', '/admin/quotes', '/admin/manual']) {
        await inspect(page, p, width);
      }
    }
    await ctx.close();
  });

  test('結果', async () => {
    const grouped = new Map<string, Finding[]>();
    for (const f of findings) {
      const key = `${f.page} @${f.width}`;
      grouped.set(key, [...(grouped.get(key) ?? []), f]);
    }
    if (grouped.size) {
      console.log('\n===== 点検で見つかった項目 =====');
      for (const [key, list] of grouped) {
        console.log(`\n${key}`);
        for (const f of list) console.log(`  - ${f.problem}`);
      }
      console.log(`\n合計 ${findings.length} 件\n`);
    } else {
      console.log('\n指摘なし\n');
    }
    // レポート目的のテストなので、ここでは失敗させない
    expect(true).toBe(true);
  });
});

// 参照だけして未使用警告を避ける
void register;
void logout;
