import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('モデルのパースと商品特徴を上段にまとめ、その下で仕様別平面図を比較する', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('各モデルのパースと特徴、その下で仕様ごとの平面図を比較できます。');
    expect(plansPage).toContain('model.features.slice(0, 4)');
    expect(plansPage).toContain('の特徴');
    expect(plansPage).toContain('商品共通');
    expect(plansPage).toContain('仕様ごとの平面図');
    expect(plansPage).toContain('grid grid-cols-2 gap-3 xl:grid-cols-3');
    expect(plansPage).not.toContain('共通参考パース');
    expect(plansPage).not.toContain('パースはモデル共通の参考画像です');

    const perspectiveIndex = plansPage.indexOf('共通パース');
    const featureIndex = plansPage.indexOf('の特徴');
    const floorplanIndex = plansPage.indexOf('仕様ごとの平面図', featureIndex + 1);
    expect(perspectiveIndex).toBeGreaterThan(-1);
    expect(featureIndex).toBeGreaterThan(perspectiveIndex);
    expect(floorplanIndex).toBeGreaterThan(featureIndex);
  });

  it('Wing・BOX・Flatを用途で固定せず、構造から来る得意分野で説明する', () => {
    expect(plansPage).toContain("headline: '広い空間をつくる'");
    expect(plansPage).toContain("headline: '機能をまとめる'");
    expect(plansPage).toContain("headline: '必要な空間を足す'");
    expect(plansPage).toContain('構造の強み');
    expect(plansPage).toContain('向いている空間');
    expect(plansPage).toContain('住まい・LDK・広めの客室・店舗・事務所');
    expect(plansPage).toContain('水回り・個室・ホテル客室・単身者用');
    expect(plansPage).toContain('寝室・書斎・事務所・物置・バックヤード');
  });

  it('管理画面で登録した仕様別平面図を旧product_imagesより優先する', () => {
    expect(plansPage).toContain('registeredFloorplanForPreset');
    expect(plansPage).toContain('bundle.previewRules.filter');
    expect(plansPage).toContain('isPresetFloorplanRule(rule, preset.code)');
    expect(plansPage).toContain("selectedPreviewKeys(bundle.options, selectedIds, 'floorplan')");
    expect(plansPage).toContain('samePreviewKeys(rule.preview_keys, keys)');
    expect(plansPage).toContain('registeredFloorplan ?? floorplanForPreset');
  });

  it('既知の比較説明がないモデルは既存の商品特徴・商品説明で安全に補完する', () => {
    expect(plansPage).toContain('modelPositioning[model.slug] ?? null');
    expect(plansPage).toContain('modelFeatures.length > 0');
    expect(plansPage).toContain('model.description');
  });

  it('共通パースは拡大でき、仕様別平面図は仕様指定でシミュレーターへ進める', () => {
    expect(plansPage).toContain('の共通パースを拡大');
    expect(plansPage).toContain('const simulatorHref = `/simulator/${model.slug}?spec=${encodeURIComponent(preset.code)}`');
    expect(plansPage).toContain('で見積シミュレーターを開く');
    expect(plansPage).toContain('この仕様で見積する');
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
