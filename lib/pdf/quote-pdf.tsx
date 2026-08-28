import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { FINISH_LEVEL_INFO, type Quote, type QuoteItem } from '@/lib/domain/types';
import { COMPANY, PROJECT_NAME } from '@/lib/site';
import { formatDate } from '@/lib/utils';

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: 'NotoSansJP',
    fonts: [
      { src: path.join(FONT_DIR, 'NotoSansJP-Regular.otf'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'NotoSansJP-Bold.otf'), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => (word.length > 1 && /[^ -]/.test(word) ? word.split('') : [word]));
  fontsRegistered = true;
}

const yen = (v: number) => `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('ja-JP')}`;
/** 数量は小数第1位まで（8.5・17.6。整数はそのまま） */
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

const s = StyleSheet.create({
  page: { fontFamily: 'NotoSansJP', fontSize: 9, paddingTop: 34, paddingBottom: 46, paddingHorizontal: 38, color: '#1d1a16', lineHeight: 1.45 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: 6 },
  meta: { fontSize: 8.5, textAlign: 'right', color: '#4b453d' },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  leftCol: { width: 290 },
  rightCol: { width: 200, fontSize: 8, color: '#4b453d' },
  customer: { fontSize: 13, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: '#1d1a16', paddingBottom: 3 },
  subject: { marginTop: 8, fontSize: 9.5 },
  // ラベルと金額は文字サイズが違うので、行を分けず 1 つの Text に入れてベースラインを揃える
  // （flexDirection: 'row' + alignItems: 'flex-end' だと箱の下端が揃うだけで、ベースラインが 11pt ほどずれる）
  totalBox: { marginTop: 10, borderBottomWidth: 2, borderBottomColor: '#5a3e2b', paddingBottom: 4 },
  totalLine: { lineHeight: 1.2 },
  totalLabel: { fontSize: 10 },
  totalValue: { fontSize: 20, fontWeight: 700 },
  terms: { marginTop: 8, fontSize: 8, color: '#4b453d' },
  companyName: { fontSize: 11, fontWeight: 700, color: '#1d1a16' },
  image: { width: 200, height: 112, objectFit: 'cover', borderRadius: 3, marginTop: 6 },
  imageNote: { fontSize: 7, color: '#7a7167', marginTop: 2 },
  table: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#1d1a16' },
  section: { flexDirection: 'row', backgroundColor: '#f3ede4', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#cfc6b8' },
  sectionLabel: { fontWeight: 700, fontSize: 8.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#cfc6b8', paddingVertical: 3, paddingHorizontal: 4 },
  th: { fontWeight: 700, backgroundColor: '#e8dfd2' },
  trSub: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#1d1a16', backgroundColor: '#faf6f0' },
  subtotalRow: { backgroundColor: '#eadcc3', borderBottomWidth: 1, borderBottomColor: '#1d1a16' },
  cNo: { width: 22, textAlign: 'center' },
  cName: { flex: 1.5 },
  cDesc: { flex: 1.1, color: '#4b453d', fontSize: 8 },
  cPrice: { width: 74, textAlign: 'right' },
  cQty: { width: 30, textAlign: 'right' },
  cAmount: { width: 80, textAlign: 'right' },
  expenseRow: { color: '#4b453d' },
  sums: { marginTop: 8, marginLeft: 'auto', width: 250 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  sumTotal: { borderTopWidth: 1, borderTopColor: '#1d1a16', marginTop: 2, paddingTop: 4, fontWeight: 700, fontSize: 11 },
  notes: { marginTop: 14, fontSize: 8, color: '#4b453d' },
  notesTitle: { fontWeight: 700, color: '#1d1a16', marginBottom: 2 },
  products: { marginTop: 14 },
  productsTitle: { fontWeight: 700, fontSize: 9.5, marginBottom: 6 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  productCard: { width: 120 },
  productImage: { width: 120, height: 90, objectFit: 'cover', borderRadius: 3, backgroundColor: '#f3ede4' },
  productName: { fontSize: 7.5, marginTop: 3 },
  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, fontSize: 7.5, color: '#7a7167', textAlign: 'center' },
});

type PdfImage = { data: Buffer; format: 'png' | 'jpg' } | null;

interface PdfInput {
  quote: Quote;
  items: QuoteItem[];
  image: PdfImage;
  productImages: Map<string, PdfImage>;
}


function QuoteDocument({ quote, items, image, productImages }: PdfInput) {
  // 防火仕様は本体側に表示する（先方指示）
  const allOptionItems = items.filter((i) => i.kind === 'option');
  const fireItems = allOptionItems.filter((i) => i.name.includes('防火'));
  const optionItems = allOptionItems.filter((i) => !i.name.includes('防火'));
  const optionExpense = items.find((i) => i.kind === 'option_expense') ?? null;
  const sitework = items.filter((i) => i.kind === 'installation');
  const freeItems = items.filter((i) => i.kind === 'free');
  const revisionLabel = quote.revision > 1 ? `（第${quote.revision}版・確定見積）` : '（概算）';
  const freeAmount = freeItems.reduce((sum, i) => sum + i.amount, 0);
  const siteworkAmount = sitework.reduce((sum, i) => sum + i.amount, 0);
  const baseTotal = quote.base_price + quote.base_expense;
  const optionTotal = quote.option_subtotal + quote.option_expense;
  const withImages = items.filter((i) => i.image_url && productImages.get(i.id));
  /** 明細 1 行（項目・摘要／備考・単価・数量・金額）。金額 0 の別途工事は「−」 */
  const row = (it: QuoteItem, opts: { dash?: boolean } = {}) => (
    <View key={it.id} style={s.tr} wrap={false}>
      <Text style={s.cNo}></Text>
      <Text style={s.cName}>{it.name}</Text>
      <Text style={s.cDesc}>{[it.description, it.remark].filter(Boolean).join(' / ')}</Text>
      <Text style={s.cPrice}>{it.unit_price > 0 ? yen(it.unit_price) : ''}</Text>
      <Text style={s.cQty}>{it.unit ? `${fmtQty(it.quantity)} ${it.unit}` : fmtQty(it.quantity)}</Text>
      <Text style={s.cAmount}>{opts.dash && it.amount === 0 ? '−' : yen(it.amount)}</Text>
    </View>
  );
  /** 【◯◯計】の小計行 */
  const subtotalRow = (label: string, amount: string) => (
    <View style={[s.tr, s.subtotalRow]} wrap={false}>
      <Text style={s.cNo}></Text>
      <Text style={[s.cName, { fontWeight: 700 }]}>{label}</Text>
      <Text style={s.cDesc}></Text>
      <Text style={s.cPrice}></Text>
      <Text style={s.cQty}></Text>
      <Text style={[s.cAmount, { fontWeight: 700 }]}>{amount}</Text>
    </View>
  );

  return (
    <Document title={`御見積書 ${quote.quote_no}`} author={COMPANY.name} language="ja">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>御見積書</Text>
          <View style={s.meta}>
            <Text>見積番号：{quote.quote_no}</Text>
            {quote.customer_no ? <Text>顧客番号：{quote.customer_no}</Text> : null}
            <Text>発行日：{formatDate(quote.issued_at)}</Text>
            <Text>有効期限：{formatDate(quote.valid_until)}</Text>
          </View>
        </View>

        <View style={s.twoCol}>
          <View style={s.leftCol}>
            <View style={s.customer}>
              {quote.customer_company ? <Text>{quote.customer_company}</Text> : null}
              <Text>{quote.customer_name} 様</Text>
            </View>
            <Text style={s.subject}>件名：折り畳み式木造コンテナ {quote.base_model_name} 一式（{FINISH_LEVEL_INFO[quote.finish_level ?? 'full'].name}・工場生産分）{revisionLabel}</Text>
            <View style={s.totalBox}>
              <Text style={s.totalLine}>
                <Text style={s.totalLabel}>御見積金額（税込）　</Text>
                <Text style={s.totalValue}>{yen(quote.total)}</Text>
              </Text>
            </View>
            <View style={s.terms}>
              <Text>支払条件：{COMPANY.paymentTerms}</Text>
              <Text>
                振込先：{COMPANY.bank.name} {COMPANY.bank.type} {COMPANY.bank.number} {COMPANY.bank.holder}
              </Text>
            </View>
          </View>
          <View style={s.rightCol}>
            <Text style={s.companyName}>{COMPANY.name}</Text>
            <Text>{PROJECT_NAME}</Text>
            <Text>本社：{COMPANY.headOffice}</Text>
            {COMPANY.offices.slice(1).map((o) => (
              <Text key={o.name}>
                {o.name}：{o.postal} {o.address}
              </Text>
            ))}
            <Text>TEL：{COMPANY.tel}</Text>
            <Text>登録番号：{COMPANY.invoiceRegistrationNo}</Text>
            {image ? (
              <View>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image style={s.image} src={image} />
                <Text style={s.imageNote}>※画像は完成イメージです。</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={[s.tr, s.th]}>
            <Text style={s.cNo}>No</Text>
            <Text style={s.cName}>項目</Text>
            <Text style={s.cDesc}>摘要・備考</Text>
            <Text style={s.cPrice}>単価</Text>
            <Text style={s.cQty}>数量</Text>
            <Text style={s.cAmount}>金額</Text>
          </View>

          {/* 1. 本体：エンドユーザーに渡る書類なので計のみ（明細は本部・総代理店・代理店の管理画面で見る） */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>1　本体価格（{quote.base_model_name}・工場生産分）</Text>
          </View>
          {fireItems.map((it) => row(it, { dash: true }))}
          <View style={s.tr} wrap={false}>
            <Text style={s.cNo}></Text>
            <Text style={s.cName}>{quote.base_model_name} 本体一式</Text>
            <Text style={s.cDesc}>躯体・金物・断熱・屋根外壁・サッシ建具（工場生産分・諸費用込み）</Text>
            <Text style={s.cPrice}></Text>
            <Text style={s.cQty}>1 式</Text>
            <Text style={s.cAmount}>{yen(baseTotal)}</Text>
          </View>
          {subtotalRow('【本体価格計】', yen(baseTotal))}

          {/* 2. オプション */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>2　オプション価格（選択された設備・仕上げ）</Text>
          </View>
          {optionItems.map((it) => row(it))}
          {optionExpense ? row(optionExpense) : null}
          {subtotalRow('【オプション価格計】', yen(optionTotal))}

          {/* 3. 別途工事（運送費を含む） */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>3　別途工事（設置場所の確認後に確定します）</Text>
          </View>
          {sitework.map((it) => row(it, { dash: true }))}
          {subtotalRow('【別途工事計】', siteworkAmount > 0 ? yen(siteworkAmount) : '別途')}

          {/* 4. フリー商品（代理店・工務店の取扱商品） */}
          {freeItems.length > 0 ? (
            <>
              <View style={s.section}>
                <Text style={s.sectionLabel}>4　フリー商品（代理店・工務店の取扱商品／諸費用なし）</Text>
              </View>
              {freeItems.map((it) => row(it))}
              {subtotalRow('【フリー商品計】', yen(freeAmount))}
            </>
          ) : null}
        </View>

        <View style={s.sums} wrap={false}>
          <View style={s.sumRow}><Text>小計</Text><Text>{yen(quote.subtotal - quote.adjustment)}</Text></View>
          <View style={s.sumRow}><Text>値引き等調整額</Text><Text>{yen(quote.adjustment)}</Text></View>
          <View style={s.sumRow}><Text>税抜請負額</Text><Text>{yen(quote.subtotal)}</Text></View>
          <View style={s.sumRow}><Text>消費税（{Math.round(Number(quote.tax_rate) * 100)}%）</Text><Text>{yen(quote.tax)}</Text></View>
          <View style={[s.sumRow, s.sumTotal]}><Text>合計（税込）</Text><Text>{yen(quote.total)}</Text></View>
        </View>

        <View style={s.notes} wrap={false}>
          <Text style={s.notesTitle}>備考</Text>
          {COMPANY.quoteNotes.map((n, i) => (
            <Text key={i}>・{n}</Text>
          ))}
          <Text>・注文範囲：{FINISH_LEVEL_INFO[quote.finish_level ?? 'full'].name} — {FINISH_LEVEL_INFO[quote.finish_level ?? 'full'].lead}</Text>
          <Text>・運搬、設置費など設置場所によって変動する費用は別途工事です。現地の代理店・工務店にお問合せください。</Text>
          {quote.dealer_note ? <Text>・代理店より：{quote.dealer_note}</Text> : null}
        </View>

        {withImages.length > 0 ? (
          <View style={s.products} break={withImages.length > 5}>
            <Text style={s.productsTitle}>選択商品</Text>
            <View style={s.productGrid}>
              {withImages.map((it) => (
                <View key={it.id} style={s.productCard} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image style={s.productImage} src={productImages.get(it.id) as Exclude<PdfImage, null>} />
                  <Text style={s.productName}>{it.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${COMPANY.name}　見積番号 ${quote.quote_no}　${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}

/** 画像 URL（/images/…・/api/local-files/…・https://…）を PDF 用の PNG/JPG バイト列にする */
async function loadImage(url: string | null, width = 1200): Promise<PdfImage> {
  if (!url) return null;
  try {
    let bytes: Buffer | null = null;
    if (url.startsWith('/images/')) {
      bytes = fs.readFileSync(path.join(process.cwd(), 'public', url));
    } else if (url.startsWith('/api/local-files/')) {
      const { filesDir } = await import('@/lib/data/local-db');
      bytes = fs.readFileSync(path.join(filesDir(), url.replace('/api/local-files/', '')));
    } else if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (!bytes) return null;
    const sharp = (await import('sharp')).default;
    const meta = await sharp(bytes).metadata();
    if (meta.format === 'jpeg' && (meta.width ?? 0) <= width) return { data: bytes, format: 'jpg' };
    return { data: await sharp(bytes).resize({ width, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(), format: 'jpg' };
  } catch (e) {
    console.warn('[wing] quote pdf image load failed', e);
    return null;
  }
}

export async function renderQuotePdf(quote: Quote, items: QuoteItem[]): Promise<Uint8Array> {
  registerFonts();
  const image = await loadImage(quote.preview_image_url);
  const productImages = new Map<string, PdfImage>();
  for (const it of items) {
    if (it.image_url) productImages.set(it.id, await loadImage(it.image_url, 600));
  }
  const buffer = await renderToBuffer(<QuoteDocument quote={quote} items={items} image={image} productImages={productImages} />);
  return new Uint8Array(buffer);
}
