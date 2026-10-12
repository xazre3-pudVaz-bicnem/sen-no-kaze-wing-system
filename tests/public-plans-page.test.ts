import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const floorplanLightbox = fs.readFileSync(path.join(root, 'components/sections/floorplan-lightbox.tsx'), 'utf8');
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

  it('Wing・BOX・Flatを形・構造、得意な使い方、主な用途の3項目で簡潔に比較する', () => {
    expect(plansPage).toContain("headline: '折り畳んで運び、現地で広げる'");
    expect(plansPage).toContain("structure: '折り畳み式'");
    expect(plansPage).toContain("bestUse: '広い室内をつくる'");
    expect(plansPage).toContain("structure: '固定式'");
    expect(plansPage).toContain("bestUse: '設備や個室をまとめる'");
    expect(plansPage).toContain("structure: '水平折畳み'");
    expect(plansPage).toContain("bestUse: '必要な一室を足す'");
    expect(plansPage).toContain('形・構造');
    expect(plansPage).toContain('得意な使い方');
    expect(plansPage).toContain('主な用途');
    expect(plansPage).toContain('住宅・ホテル・店舗・事務所');
    expect(plansPage).toContain('客室・水回り・ワンルーム');
    expect(plansPage).toContain('寝室・書斎・事務所・物置');
    expect(plansPage).not.toContain('positioning.summary');
    expect(plansPage).not.toContain('positioning.strength');
    expect(plansPage).not.toContain('構造の強み');
    expect(plansPage).not.toContain('向いている空間');
    expect(plansPage).not.toContain('WingStructureMotion');
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

  it('仕様別平面図はページ内ポップアップで拡大し、見積導線は別リンクにする', () => {
    expect(plansPage).toContain("import { FloorplanLightbox } from '@/components/sections/floorplan-lightbox'");
    expect(plansPage).toContain('平面図を押すと大きく確認できます。');
    expect(plansPage).toContain('<FloorplanLightbox');
    expect(plansPage).toContain('src={floorplan.url}');
    expect(plansPage).toContain('presetName={preset.name}');
    expect(plansPage).toContain('const simulatorHref = `/simulator/${model.slug}?spec=${encodeURIComponent(preset.code)}`');
    expect(plansPage).toContain('この仕様で見積する');
    expect(plansPage).toContain('平面図準備中');

    expect(floorplanLightbox).toContain("'use client'");
    expect(floorplanLightbox).toContain('showModal()');
    expect(floorplanLightbox).toContain('<dialog');
    expect(floorplanLightbox).toContain('dialogRef.current?.close()');
    expect(floorplanLightbox).toContain('cursor-zoom-in');
    expect(floorplanLightbox).toContain('平面図を閉じる');
    expect(floorplanLightbox).toContain('backdrop:bg-black/70');
  });

  it('共通パースは従来どおり拡大できる', () => {
    expect(plansPage).toContain('の共通パースを拡大');
    expect(plansPage).toContain('target="_blank"');
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
