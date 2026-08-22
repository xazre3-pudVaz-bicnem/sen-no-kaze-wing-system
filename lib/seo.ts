import type { Metadata } from 'next';
import { absoluteUrl, COMPANY, getSiteUrl, SITE_NAME } from '@/lib/site';
import type { BaseModel } from '@/lib/domain/types';
import { baseTotalOf } from '@/lib/domain/pricing';

interface BuildMetadataInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  noindex?: boolean;
  keywords?: string[];
  type?: 'website' | 'article';
}

export function buildMetadata({ title, description, path, image = '/images/hero/sunset-sea.webp', noindex, keywords, type = 'website' }: BuildMetadataInput): Metadata {
  const siteUrl = getSiteUrl();
  const fullTitle = path === '/' ? title : `${title}｜${SITE_NAME}`;
  const meta: Metadata = {
    title: fullTitle,
    description,
    keywords,
    robots: noindex ? { index: false, follow: false, nocache: true } : siteUrl ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: fullTitle,
      description,
      siteName: SITE_NAME,
      locale: 'ja_JP',
      type,
      ...(siteUrl ? { url: `${siteUrl}${path}`, images: [{ url: `${siteUrl}${image}`, width: 1200, height: 630 }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description },
  };
  if (siteUrl && !noindex) meta.alternates = { canonical: `${siteUrl}${path}` };
  return meta;
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: COMPANY.name,
    url: getSiteUrl() ?? COMPANY.url,
    telephone: COMPANY.tel,
    address: { '@type': 'PostalAddress', addressCountry: 'JP', streetAddress: COMPANY.headOffice },
    ...(absoluteUrl('/images/brand/sennokaze-logo.png') ? { logo: absoluteUrl('/images/brand/sennokaze-logo.png') } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  const base = getSiteUrl() ?? '';
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${base}${it.path}`,
    })),
  };
}

export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function productJsonLd(model: BaseModel, imageUrls: string[]) {
  const base = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${model.name}（折り畳み式木造コンテナ Wing）`,
    description: model.description,
    brand: { '@type': 'Brand', name: 'Wing' },
    manufacturer: { '@type': 'Organization', name: COMPANY.name },
    ...(base ? { image: imageUrls.map((u) => (u.startsWith('http') ? u : `${base}${u}`)), url: `${base}/products/${model.slug}` } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'JPY',
      price: baseTotalOf(model),
      priceSpecification: { '@type': 'UnitPriceSpecification', price: baseTotalOf(model), priceCurrency: 'JPY', valueAddedTaxIncluded: false },
      availability: 'https://schema.org/PreOrder',
      description: '本体価格計（本体一式＋諸費用・税別）。オプション・別途工事は含みません。',
    },
  };
}
