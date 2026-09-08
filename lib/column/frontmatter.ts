/**
 * コラム記事ファイルの frontmatter 解析。
 * 依存を増やさないため、使う書式だけに絞った小さなパーサーにしている。
 *
 * 対応する書式（YAML のサブセット）:
 *   key: value
 *   key: [a, b]                       ← 文字列の配列（1行）
 *   key:
 *     - label: ...                    ← オブジェクトの配列
 *       url: ...
 */

export type FrontmatterValue = string | string[] | Record<string, string>[];

const stripQuotes = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');

export function parseFrontmatter(raw: string): { data: Record<string, FrontmatterValue>; body: string } {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };

  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const data: Record<string, FrontmatterValue> = {};

  const lines = head.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const inline = m[2].trim();
    i++;

    if (inline.startsWith('[') && inline.endsWith(']')) {
      const inner = inline.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map(stripQuotes).filter(Boolean) : [];
      continue;
    }
    if (inline) {
      data[key] = stripQuotes(inline);
      continue;
    }

    // ブロック（配列）
    const objects: Record<string, string>[] = [];
    const strings: string[] = [];
    let current: Record<string, string> | null = null;
    while (i < lines.length && /^\s+/.test(lines[i])) {
      const item = lines[i];
      const dash = /^\s*-\s*(.*)$/.exec(item);
      if (dash) {
        const rest = dash[1];
        const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(rest);
        if (kv) {
          current = { [kv[1]]: stripQuotes(kv[2]) };
          objects.push(current);
        } else if (rest) {
          strings.push(stripQuotes(rest));
          current = null;
        }
      } else if (current) {
        const kv = /^\s+([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(item);
        if (kv) current[kv[1]] = stripQuotes(kv[2]);
      }
      i++;
    }
    data[key] = objects.length ? objects : strings;
  }

  return { data, body };
}

/** frontmatter を書き出す（自動生成スクリプトが使う） */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const esc = (v: string) => (/[:#]|^\s|\s$/.test(v) ? `'${v.replace(/'/g, "''")}'` : v);
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (typeof value[0] === 'string') {
        lines.push(`${key}: [${(value as string[]).map(esc).join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const obj of value as Record<string, string>[]) {
          const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== '');
          entries.forEach(([k, v], idx) => lines.push(`${idx === 0 ? '  - ' : '    '}${k}: ${esc(String(v))}`));
        }
      }
    } else {
      lines.push(`${key}: ${esc(String(value))}`);
    }
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}
