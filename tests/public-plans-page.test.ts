import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('モデル共通パースを1枚だけ表示し、仕様差は平面図と短い説明で比較する', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('各モデルの共通パースと、仕様ごとの平面図・特徴を見比べられます。');
    expect(plansPage).toContain('model.presets ?? []');
    expect(plansPage).toContain('共通パース');
    expect(plansPage).toContain('preset.description');
    expect(plansPage).toContain('grid grid-cols-2 gap-3 xl:grid-cols-3');
    expect(plansPage).not.toContain('共通参考パース');
    expect(plansPage).not.toContain('パースはモデル共通の参考画像です');
    expect(plansPage).not.toContain('imageForPreset(model.slug, preset.code, perspectives)');
  });

  it('共通パースはモデル単位、平面図は仕様単位で拡大できる', () => {
    expect(plansPage).toContain('の共通パースを拡大');
    expect(plansPage).toContain('の平面図を拡大');
    expect(plansPage).toContain('target="_blank"');
    expect(plansPage).toContain('平面図準備中');
  });

  it('Wing / BOX / Flatを同じページ内で移動して確認できる', () => {
    expect(plansPage).toContain('href={`#model-${model.slug}`}');
    expect(plansPage).toContain('id={`model-${model.slug}`}');
    expect(plansPage).toContain("name === 'フラット' ? 'Flat' : name");
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
