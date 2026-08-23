import { buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';

export const metadata = buildMetadata({
  title: '特定商取引法に基づく表記',
  description: '株式会社技術の杜（千の風プロジェクト）の特定商取引法に基づく表記。会社概要・所在地・事業内容・許認可・お支払い方法などを記載しています。',
  path: '/sct',
});

export default function SctPage() {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: '会社名', value: COMPANY.name },
    {
      label: '代表取締役',
      value: (
        <>
          代表取締役　{COMPANY.representative}
          <span className="mt-1 block text-sm text-muted">{COMPANY.representativeBio}</span>
        </>
      ),
    },
    {
      label: '所在地',
      value: (
        <ul className="space-y-2">
          {COMPANY.offices.slice(0, 2).map((o) => (
            <li key={o.name}>
              <span className="block text-sm text-muted">{o.name}</span>
              {o.postal}　{o.address}
            </li>
          ))}
        </ul>
      ),
    },
    { label: '設立', value: COMPANY.established },
    { label: '資本金', value: COMPANY.capital },
    {
      label: '事業内容',
      value: (
        <ul className="list-disc space-y-1 pl-5">
          {COMPANY.business.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ),
    },
    {
      label: '許認可',
      value: (
        <ul className="space-y-1">
          {COMPANY.licenses.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ),
    },
    { label: 'お問い合わせ', value: 'お問い合わせフォームよりご連絡ください' },
    { label: 'お支払い方法', value: 'クレジットカード、銀行振込、代金引換、コンビニ決済など' },
    { label: 'お支払い時期', value: 'クレジットカード：注文時決済 / 銀行振込：注文後７日以内など' },
    { label: '商品の引き渡し時期', value: '入金確認後、７営業日以内に発送' },
    { label: '返品・交換・キャンセル', value: '不良品以外の返品・交換はお受けしておりません' },
  ];

  return (
    <Container className="max-w-4xl pt-10 pb-24 sm:pt-14">
      <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '特定商取引法に基づく表記' }]} />
      <div className="py-12 sm:py-16">
        <RuleHeading as="h1" labelEn="Specified Commercial Transactions" title="特定商取引法に基づく表記" tone="light" />
      </div>
      <p className="text-ink-soft leading-[1.95]">
        私たちは、自社独自の折り畳み式木造コンテナを活用した宿泊施設の提案、製造・販売を行っています。使われていない土地の活用や、既存事業との組み合わせにより、新しい宿泊事業づくりを支援しています。
      </p>
      <dl className="mt-10 divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-2 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
            <dt className="font-semibold">{r.label}</dt>
            <dd className="text-ink-soft">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Container>
  );
}
