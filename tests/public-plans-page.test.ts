import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('仕様ごとにパースと平面図をセットでコンパクト表示する', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('各仕様のパースと平面図をセットで見比べられます。');
    expect(plansPage).toContain('model.presets ?? []');
    expect(plansPage).toContain('grid grid-cols-2 gap-px bg-line');
    expect(plansPage).toContain('共通参考パース');
    expect(plansPage).toContain('パースはモデル共通の参考画像です');
    expect(plansPage).toContain('sm:grid-cols-2 xl:grid-cols-3');
    expect(plansPage).not.toContain('model.description');
  });

  it('仕様名に対応する画像があれば優先し、未登録時は安全な代替表示にする', () => {
    expect(plansPage).toContain('imageForPreset(model.slug, preset.code, perspectives)');
    expect(plansPage).toContain('matchedPerspective ?? commonPerspective');
    expect(plansPage).toContain('パース準備中');
    expect(plansPage).toContain('平面図準備中');
  });

  it('Wing / BOX / Flatを同じページ内で移動して確認できる', () => {
    expect(plansPage).toContain('href={`#model-${model.slug}`}');
    expect(plansPage).toContain('id={`model-${model.slug}`}');
    expect(plansPage).toContain("name === 'フラット' ? 'Flat' : name");
  });

  it('パースと平面図はどちらも拡大できる', () => {
    expect(plansPage).toContain('のパースを拡大');
    expect(plansPage).toContain('の平面図を拡大');
    expect(plansPage).toContain('target="_blank"');
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
