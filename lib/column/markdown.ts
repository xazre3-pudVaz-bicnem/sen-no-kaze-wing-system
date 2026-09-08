/**
 * コラム本文用の Markdown サブセット解析。
 *
 * 生成モデルの出力は信頼できない入力として扱うため、HTML をそのまま描画せず、
 * 許可したノード種別だけの構造（ColumnNode）へ変換する。
 * これにより `dangerouslySetInnerHTML` を使わずに済み、XSS を構造的に防ぐ。
 */

export type ColumnInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'link'; value: string; href: string; external: boolean };

export type ColumnNode =
  | { type: 'heading'; level: 2 | 3; text: string; id: string }
  | { type: 'paragraph'; children: ColumnInline[] }
  | { type: 'list'; ordered: boolean; items: ColumnInline[][] }
  | { type: 'quote'; children: ColumnInline[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'hr' };

/** 外部リンクを許可するホスト（一次情報・自社サイトのみ） */
const ALLOWED_EXTERNAL_HOSTS = [
  'www.sen-no-kaze.com',
  'sen-no-kaze-wing-system.vercel.app',
  'gijutsu.co.jp',
  'www.gijutsu.co.jp',
  'www.mlit.go.jp',
  'www.jnto.go.jp',
  'www.kokudo.go.jp',
  'elaws.e-gov.go.jp',
  'www.e-gov.go.jp',
  'www.mhlw.go.jp',
  'www.soumu.go.jp',
  'www.nta.go.jp',
  'www.jtb.or.jp',
];

/** 見出しから安定した id を作る（目次のアンカー用） */
export function headingId(text: string, index: number): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // 日本語見出しはそのままだと URL で扱いにくいので連番を必ず付ける
  return `h-${index + 1}${ascii ? `-${encodeURIComponent(ascii).slice(0, 40)}` : ''}`;
}

/** リンク先の検証。内部パスと許可ホストの https だけ通す */
export function normalizeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//')) {
    // 内部リンク。管理・会員ページへは張らせない
    if (/^\/(admin|mypage|api|login|register|reset-password|auth)(\/|$)/.test(href)) return null;
    return { href, external: false };
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_EXTERNAL_HOSTS.includes(url.host)) return null;
  return { href: url.toString(), external: true };
}

/** 太字とリンクだけを解釈する。未知の記法・生 HTML はテキストとして扱う */
function parseInline(raw: string): ColumnInline[] {
  // 生 HTML タグは描画対象にしない（文字として残さず除去する）
  const text = raw.replace(/<[^>]*>/g, '');
  const out: ColumnInline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ type: 'strong', value: m[1] });
    } else {
      const link = normalizeHref(m[3] ?? '');
      if (link) out.push({ type: 'link', value: m[2] ?? '', href: link.href, external: link.external });
      else out.push({ type: 'text', value: m[2] ?? '' }); // 不正なリンクはリンクにしない
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out.filter((n) => n.type !== 'text' || n.value !== '');
}

const splitRow = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** Markdown サブセット → 安全なノード列 */
export function parseColumnMarkdown(md: string): ColumnNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const nodes: ColumnNode[] = [];
  let headingIndex = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 水平線
    if (/^-{3,}$/.test(trimmed)) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // 見出し（h2 / h3 のみ。h1 はページ側の記事タイトルが持つ）
    const h = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (h) {
      const level = h[1].length === 2 ? 2 : 3;
      const text = h[2].replace(/<[^>]*>/g, '').trim();
      nodes.push({ type: 'heading', level: level as 2 | 3, text, id: headingId(text, headingIndex) });
      headingIndex++;
      i++;
      continue;
    }

    // 表
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?[\s:-]+\|/.test(lines[i + 1].trim())) {
      const head = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()).map((c) => c.replace(/<[^>]*>/g, '')));
        i++;
      }
      nodes.push({ type: 'table', head: head.map((c) => c.replace(/<[^>]*>/g, '')), rows });
      continue;
    }

    // 箇条書き（順序なし／あり）
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: ColumnInline[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const b = isOrdered ? /^\d+\.\s+(.+)$/.exec(t) : /^[-*]\s+(.+)$/.exec(t);
        if (!b) break;
        items.push(parseInline(b[1]));
        i++;
      }
      nodes.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    // 引用
    if (trimmed.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({ type: 'quote', children: parseInline(buf.join(' ')) });
      continue;
    }

    // 段落（空行まで）
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|[-*]\s|\d+\.\s|>|\|)/.test(lines[i].trim()) && !/^-{3,}$/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) nodes.push({ type: 'paragraph', children: parseInline(buf.join('')) });
  }

  return nodes;
}

/** 目次に出す見出し（h2 のみ） */
export function tocItems(nodes: ColumnNode[]): { id: string; text: string }[] {
  return nodes.filter((n): n is Extract<ColumnNode, { type: 'heading' }> => n.type === 'heading' && n.level === 2).map((n) => ({ id: n.id, text: n.text }));
}

/** 本文の文字数（全角基準のおおよその目安。検証で使う） */
export function bodyLength(md: string): number {
  return md.replace(/\s+/g, '').length;
}
