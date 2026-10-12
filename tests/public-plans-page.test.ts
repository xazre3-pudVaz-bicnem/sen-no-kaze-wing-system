import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const wingMotion = fs.readFileSync(path.join(root, 'components/sections/wing-structure-motion.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('モデルのパースと商品特徴を上段にまとめ、その下で仕様別平面図を比較する', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('パースと平面図を見ながら、単体モデルと組み合わせ例を比べられます。');
    expect(plansPage).toContain('model.features.slice(0, 4)');
    expect(plansPage).toContain('の特徴');
    expect(plansPage).toContain('商品共通');
    expect(plansPage).toContain('仕様ごとの平面図');
    expect(plansPage).toContain('grid grid-cols-2 gap-3 xl:grid-cols-3');
    expect(plansPage).not.toContain('共通参考パース');
    expect(plansPage).not.toContain('パースはモデル共通の参考画像です');

    const perspectiveIndex = plansPage.indexOf('共通パース');
    const featureIndex = plansPage.indexOf('の特徴', perspectiveIndex + 1);
    const floorplanIndex = plansPage.indexOf('仕様ごとの平面図', featureIndex + 1);
    expect(perspectiveIndex).toBeGreaterThan(-1);
    expect(featureIndex).toBeGreaterThan(perspectiveIndex);
    expect(floorplanIndex).toBeGreaterThan(featureIndex);
  });

  it('Wing・BOX・Flatを用途で固定せず、自然な商品説明で違いを伝える', () => {
    expect(plansPage).toContain("headline: '折り畳んで運び、現地で広げる'");
    expect(plansPage).toContain("headline: 'コンパクトな箱型ユニット'");
    expect(plansPage).toContain("headline: '必要な場所に、もう一室'");
    expect(plansPage).toContain('特徴');
    expect(plansPage).toContain('主な用途');
    expect(plansPage).toContain('住宅・ホテル・店舗・事務所');
    expect(plansPage).toContain('ホテル客室・単身者用・水回り・個室');
    expect(plansPage).toContain('寝室・書斎・事務所・物置');
    expect(plansPage).not.toContain('構造の強み');
    expect(plansPage).not.toContain('向いている空間');
  });

  it('Wingは正しい展開順を線だけの4コマ風アニメで見せる', () => {
    expect(plansPage).toContain("import { WingStructureMotion } from '@/components/sections/wing-structure-motion'");
    expect(plansPage).toContain("model.slug === 'wing-01' && <WingStructureMotion />");
    expect(wingMotion).toContain('展開の流れ');
    expect(wingMotion).toContain('構造を簡略化したイメージ');
    const folded = wingMotion.indexOf('折り畳み</span>');
    const wall = wingMotion.indexOf('壁が開く</span>');
    const floor = wingMotion.indexOf('床が下りる</span>');
    const opened = wingMotion.indexOf('展開</span>');
    expect(folded).toBeGreaterThan(-1);
    expect(wall).toBeGreaterThan(folded);
    expect(floor).toBeGreaterThan(wall);
    expect(opened).toBeGreaterThan(floor);
    expect(wingMotion).toContain('prefers-reduced-motion: reduce');
  });

  it('上部ナビは単体モデルと組み合わせを上下2段で画像付き表示する', () => {
    expect(plansPage).toContain('単体モデル');
    expect(plansPage).toContain('組み合わせ');
    expect(plansPage).toContain('modelNavItems');
    expect(plansPage).toContain('visibleCombinations');
    expect(plansPage).toContain('href={`#model-${model.slug}`}');
    expect(plansPage).toContain('href={`#combo-${combination.id}`}');
    expect(plansPage).toContain('h-9 w-12');
  });

  it('Wing+BOX・Wing+Flat・BOX+Flatの既存画像を組み合わせ例として表示する', () => {
    expect(plansPage).toContain("image: '/images/plan/wing-box-combo.jpg'");
    expect(plansPage).toContain("image: '/images/plan/flat-wing-2ldk.jpg'");
    expect(plansPage).toContain("image: '/images/plan/box-flat-combo.jpg'");
    expect(plansPage).toContain("id: 'wing-box'");
    expect(plansPage).toContain("id: 'wing-flat'");
    expect(plansPage).toContain("id: 'box-flat'");
    expect(plansPage).toContain('id={`combo-${combination.id}`}');
    expect(plansPage).toContain('組み合わせイメージを拡大');
  });

  it('組み合わせ例は専用見積へ直結させず構成モデルへ戻れる', () => {
    expect(plansPage).toContain('combination.modelSlugs.map');
    expect(plansPage).toContain('href={`#model-${slug}`}');
    expect(plansPage).toContain('を見る');
    expect(plansPage).not.toContain('この組み合わせで見積する');
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
