import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('公開カタログから平面図と参考パース中心のコンパクト表示を組み立てる', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('平面図とパースから仕様を選ぶ');
    expect(plansPage).toContain('model.presets ?? []');
    expect(plansPage).toContain('※モデル共通の参考パースです。');
    expect(plansPage).toContain('sm:grid-cols-2 xl:grid-cols-3');
    expect(plansPage).not.toContain('model.description');
    expect(plansPage).not.toContain("image.kind === 'interior'");
  });

  it('Wing / BOX / Flatを同じページ内で移動して確認できる', () => {
    expect(plansPage).toContain('href={`#model-${model.slug}`}');
    expect(plansPage).toContain('id={`model-${model.slug}`}');
    expect(plansPage).toContain("name === 'フラット' ? 'Flat' : name");
  });

  it('平面図は拡大でき、未登録仕様は準備中として扱う', () => {
    expect(plansPage).toContain('target="_blank"');
    expect(plansPage).toContain('平面図を拡大');
    expect(plansPage).toContain('平面図準備中');
  });

  it('確認後に各モデルの見積シミュレーターへ進める', () => {
    expect(plansPage).toContain('href={`/simulator/${model.slug}`}');
    expect(plansPage).toContain('の見積シミュレーターへ');
    expect(productChapters).toContain('href={`/plans#model-${model.slug}`}');
    expect(productChapters).toContain('仕様・間取りを見る');
  });

  it('公開サイトマップへ仕様・間取りページを含める', () => {
    expect(sitemap).toContain("{ url: `${base}/plans`");
  });
});
