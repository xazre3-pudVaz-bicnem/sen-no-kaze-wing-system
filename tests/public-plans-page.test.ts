import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const plansPage = fs.readFileSync(path.join(root, 'app/(site)/plans/page.tsx'), 'utf8');
const imageLightbox = fs.readFileSync(path.join(root, 'components/sections/image-lightbox.tsx'), 'utf8');
const productChapters = fs.readFileSync(path.join(root, 'components/sections/product-chapters.tsx'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf8');

describe('公開 商品・仕様・間取りページ', () => {
  it('間取りからモデルを選ぶ導入文の下でパース・特徴・仕様別平面図を比較する', () => {
    expect(plansPage).toContain('getPublicCatalog');
    expect(plansPage).toContain('間取りからモデルを選ぶ');
    expect(plansPage).toContain('外観・特徴・間取りを見ながら、Wing・BOX・Flatの違いや組み合わせ例を比較できます。');
    expect(plansPage).not.toContain('平面図とパースから仕様を選ぶ');
    expect(plansPage).not.toContain('パースと平面図を見ながら、単体モデルと組み合わせ例を比べられます。');
    expect(plansPage).toContain('model.features.slice(0, 4)');
    expect(plansPage).toContain('の特徴');
    expect(plansPage).toContain('仕様ごとの平面図');
    expect(plansPage).toContain('grid grid-cols-2 gap-3 xl:grid-cols-3');
    expect(plansPage).not.toContain('共通参考パース');
    expect(plansPage).not.toContain('パースはモデル共通の参考画像です');

    const perspectiveIndex = plansPage.indexOf('代表パース');
    const featureIndex = plansPage.indexOf('の特徴', perspectiveIndex + 1);
    const floorplanIndex = plansPage.indexOf('仕様ごとの平面図', featureIndex + 1);
    expect(perspectiveIndex).toBeGreaterThan(-1);
    expect(featureIndex).toBeGreaterThan(perspectiveIndex);
    expect(floorplanIndex).toBeGreaterThan(featureIndex);
  });

  it('Wing・BOX・Flatを基本サイズ・構造・用途・特徴の4項目で表示する', () => {
    expect(plansPage).toContain("size: '3,900 × 4,800'");
    expect(plansPage).toContain("structure: '折り畳み式。トラック1台分の運搬サイズから、設置後はコンテナ2個分の広さに展開'");
    expect(plansPage).toContain("uses: '住宅・ホテル・事務所・店舗など'");
    expect(plansPage).toContain("feature: '広い室内空間と木造ならではの雰囲気を両立'");
    expect(plansPage).toContain("size: '2,100 × 4,800'");
    expect(plansPage).toContain("structure: '固定式。上下に重ねて、2階建て以上の構成にも対応可能'");
    expect(plansPage).toContain("uses: 'ホテル・ワンルーム・仮設事務所・水回りユニットなど'");
    expect(plansPage).toContain("feature: 'コンパクトに機能をまとめやすく、Wingと水回りキットとして組み合わせ可能'");
    expect(plansPage).toContain("size: '2,100 × 1,800〜4,800（複数サイズあり）'");
    expect(plansPage).toContain("structure: '水平折り畳み式。平らに折り畳んで平積み配送可能'");
    expect(plansPage).toContain("uses: '物置・寝室・書斎・事務所など、追加の一室として'");
    expect(plansPage).toContain("feature: 'Wing＋Flatで2LDK、BOX＋Flatなど、他モデルと組み合わせて使いやすい'");
    expect(plansPage).toContain('基本サイズ');
    expect(plansPage).toContain('構造');
    expect(plansPage).toContain('用途');
    expect(plansPage).toContain('特徴');
    expect(plansPage).not.toContain('得意な使い方');
    expect(plansPage).not.toContain('主な用途');
    expect(plansPage).not.toContain('positioning.headline');
    expect(plansPage).not.toContain('WingStructureMotion');
  });

  it('上部ナビは単体モデルと組み合わせを上下2段で代表外観付き表示する', () => {
    expect(plansPage).toContain('単体モデル');
    expect(plansPage).toContain('組み合わせ');
    expect(plansPage).toContain('modelNavItems');
    expect(plansPage).toContain('representativeImageBySlug');
    expect(plansPage).toContain('visibleCombinations');
    expect(plansPage).toContain('href={`#model-${model.slug}`}');
    expect(plansPage).toContain('href={`#combo-${combination.id}`}');
    expect(plansPage).toContain('combination.modelSlugs.map((slug) =>');
    expect(plansPage).toContain('representativeImageBySlug.get(slug)');
    expect(plansPage).toContain('sizes="24px"');
  });

  it('Wing+BOX・Wing+Flat・BOX+Flatの既存平面図は下部の組み合わせ例として残す', () => {
    expect(plansPage).toContain("image: '/images/plan/wing-box-combo.jpg'");
    expect(plansPage).toContain("image: '/images/plan/flat-wing-2ldk.jpg'");
    expect(plansPage).toContain("image: '/images/plan/box-flat-combo.jpg'");
    expect(plansPage).toContain("id: 'wing-box'");
    expect(plansPage).toContain("id: 'wing-flat'");
    expect(plansPage).toContain("id: 'box-flat'");
    expect(plansPage).toContain('id={`combo-${combination.id}`}');
    expect(plansPage).toContain('title={`${combination.name}の組み合わせ平面図`}');
  });

  it('組み合わせ例はカード内リンクを置かず、共通問い合わせへまとめる', () => {
    expect(plansPage).not.toContain('href={`#model-${slug}`}');
    expect(plansPage).not.toContain('この組み合わせについて相談する');
    expect(plansPage).toContain('<ButtonLink href="/contact?topic=multi-model" size="sm">');
    expect(plansPage).toContain('組み合わせについて問い合わせる');
    expect(plansPage).not.toContain('この組み合わせで見積する');
  });

  it('管理画面の完成イメージで先頭に並ぶ公開外観を代表パースにする', () => {
    expect(plansPage).toContain('registeredRepresentativePerspective');
    expect(plansPage).toContain("row.view === 'exterior'");
    expect(plansPage).toContain("row.kind === 'composite'");
    expect(plansPage).toContain("row.status === 'published'");
    expect(plansPage).toContain('.sort((a, c) => a.preview_keys.length - c.preview_keys.length)[0] ?? null');
    expect(plansPage).toContain('registeredRepresentativePerspective(bundle) ?? legacyCommonPerspective(images)');
    expect(plansPage).not.toContain("rule.preview_keys.length === 0");
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

  it('パースと平面図は同じページ内ポップアップで拡大し、拡大画像のクリックでも閉じる', () => {
    expect(plansPage).toContain("import { ImageLightbox } from '@/components/sections/image-lightbox'");
    expect(plansPage).toContain('平面図を押すと大きく確認できます。');
    expect(plansPage).toContain('title={`${modelName}の代表パース`}');
    expect(plansPage).toContain('title={`${modelName} ${preset.name}の平面図`}');
    expect(plansPage).toContain('const simulatorHref = `/simulator/${model.slug}?spec=${encodeURIComponent(preset.code)}`');
    expect(plansPage).toContain('この仕様で見積をシミュレーションする');
    expect(plansPage).not.toContain('この仕様で見積する');
    expect(plansPage).toContain('text-[13px]');
    expect(plansPage).toContain('sm:text-sm');
    expect(plansPage).toContain('平面図準備中');

    expect(imageLightbox).toContain("'use client'");
    expect(imageLightbox).toContain('showModal()');
    expect(imageLightbox).toContain('<dialog');
    expect(imageLightbox).toContain('dialogRef.current?.close()');
    expect(imageLightbox).toContain('cursor-zoom-in');
    expect(imageLightbox).toContain('cursor-zoom-out');
    expect(imageLightbox).toContain('aria-label={`${title}を閉じる`}');
    expect(imageLightbox).toContain('backdrop:bg-black/70');
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