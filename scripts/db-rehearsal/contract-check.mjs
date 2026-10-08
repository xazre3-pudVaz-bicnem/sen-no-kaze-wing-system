/**
 * アプリ（Supabase クライアント呼び出し）と DB スキーマの突き合わせ。
 *
 * 検出するもの
 *   - .rpc('name', {...})        … 関数が無い／引数名が合う定義が無い
 *   - .from('table')             … テーブルが無い
 *   - .select('a,b,rel(c)') / .eq('col') / .order('col') / .insert({col}) など … 列が無い
 *
 * 文字列リテラルで書かれた箇所だけが対象。動的に組み立てた箇所は件数だけ返す。
 * LocalStore（ローカル検証モード）は DB を使わないので対象外。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'overlaps', 'order', 'not', 'filter']);
const SOURCE_DIRS = ['app', 'components', 'lib', 'scripts'];
const IDENT = /^[a-z_][a-z0-9_]*$/;

function sourceFiles(repo) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/local-(store|db)\.ts$/.test(e.name)) out.push(full);
    }
  };
  for (const d of SOURCE_DIRS) if (fs.existsSync(path.join(repo, d))) walk(path.join(repo, d));
  return out;
}

/** PostgREST の select 文字列を分解して、存在しない列・埋め込み先を issues へ積む */
function checkSelect(sel, table, where, tables, issues) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p || p === '*') continue;
    const embed = p.match(/^([^()]*)\((.*)\)$/s);
    if (embed) {
      // 埋め込み: alias:relation!hint(...)
      let rel = embed[1].trim();
      if (rel.includes(':')) rel = rel.split(':').pop().trim();
      rel = rel.split('!')[0].trim();
      if (!tables.has(rel)) {
        issues.push({ where, kind: 'table', table: rel, detail: `埋め込み先テーブル ${rel} が無い` });
        continue;
      }
      checkSelect(embed[2], rel, where, tables, issues);
      continue;
    }
    // alias:col::cast / col->json / col
    let col = p.replace(/^[a-zA-Z_][a-zA-Z0-9_]*:(?!:)/, '');
    col = col.split('::')[0].split('->')[0].trim();
    if (!IDENT.test(col) || col === 'count') continue;
    if (!tables.get(table).has(col)) issues.push({ where, kind: 'column', table, column: col, detail: `${table}.${col} が無い（select）` });
  }
}

/**
 * @param {string} repo リポジトリのルート
 * @param {{signatures: any[], columns: Record<string, string[]>}} schema inspect.sql の結果
 */
export function contractCheck(repo, schema) {
  const tables = new Map(Object.entries(schema.columns).map(([t, cols]) => [t, new Set(cols)]));
  const fnByName = new Map();
  for (const s of schema.signatures) {
    if (!fnByName.has(s.name)) fnByName.set(s.name, []);
    fnByName.get(s.name).push(s);
  }
  const issues = [];
  const stats = { files: 0, rpc: 0, from: 0, select: 0, dynamic: 0 };
  const str = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);

  for (const file of sourceFiles(repo)) {
    stats.files++;
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const loc = (n) => `${path.relative(repo, file).replace(/\\/g, '/')}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const keysOf = (obj) => {
      const keys = [];
      let dynamic = false;
      for (const pr of obj.properties) {
        if (ts.isPropertyAssignment(pr) || ts.isShorthandPropertyAssignment(pr)) keys.push(pr.name.getText(sf).replace(/['"]/g, ''));
        else dynamic = true;
      }
      return { keys, dynamic };
    };

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;

        if (method === 'rpc') {
          const name = str(node.arguments[0]);
          if (name) {
            stats.rpc++;
            const overloads = fnByName.get(name);
            const arg = node.arguments[1];
            if (!overloads) issues.push({ where: loc(node), kind: 'rpc', name, detail: `関数 ${name} が無い` });
            else if (arg && !ts.isObjectLiteralExpression(arg)) stats.dynamic++;
            else {
              const { keys, dynamic } = arg ? keysOf(arg) : { keys: [], dynamic: false };
              if (dynamic) stats.dynamic++;
              else {
                const ok = overloads.some((o) => {
                  const required = o.args.slice(0, o.nargs - o.ndefaults);
                  return keys.every((k) => o.args.includes(k)) && required.every((r) => keys.includes(r));
                });
                if (!ok) {
                  issues.push({ where: loc(node), kind: 'rpc-args', name, detail: `${name}(${keys.join(', ')}) に合う定義が無い。DB 側: ${overloads.map((o) => `(${o.args.join(', ')})`).join(' | ')}` });
                }
              }
            }
          }
        }

        // storage.from('bucket') はテーブルではない
        if (method === 'from' && !/\.storage\s*$/.test(node.expression.expression.getText(sf))) {
          const table = str(node.arguments[0]);
          if (table) {
            stats.from++;
            if (!tables.has(table)) issues.push({ where: loc(node), kind: 'table', table, detail: `テーブル ${table} が無い` });
            else {
              // .from('t') から続くメソッドチェーンをたどる
              let cur = node;
              while (cur.parent && ts.isPropertyAccessExpression(cur.parent) && cur.parent.parent && ts.isCallExpression(cur.parent.parent)) {
                const call = cur.parent.parent;
                const m = cur.parent.name.text;
                const a0 = call.arguments[0];
                if (m === 'select') {
                  const s = str(a0);
                  if (s !== null) {
                    stats.select++;
                    checkSelect(s, table, loc(call), tables, issues);
                  } else if (a0) stats.dynamic++;
                } else if (FILTERS.has(m)) {
                  const c = str(a0);
                  const foreign = call.arguments.some((x) => /referencedTable|foreignTable/.test(x.getText(sf)));
                  if (c && IDENT.test(c) && !foreign && !tables.get(table).has(c)) {
                    issues.push({ where: loc(call), kind: 'column', table, column: c, detail: `${table}.${c} が無い（.${m}）` });
                  }
                } else if (m === 'insert' || m === 'update' || m === 'upsert') {
                  const objs = a0 && ts.isArrayLiteralExpression(a0) ? a0.elements : a0 ? [a0] : [];
                  for (const o of objs) {
                    if (!ts.isObjectLiteralExpression(o)) {
                      stats.dynamic++;
                      continue;
                    }
                    const { keys, dynamic } = keysOf(o);
                    if (dynamic) stats.dynamic++;
                    for (const k of keys) {
                      if (IDENT.test(k) && !tables.get(table).has(k)) issues.push({ where: loc(call), kind: 'column', table, column: k, detail: `${table}.${k} が無い（.${m}）` });
                    }
                  }
                }
                cur = call;
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const seen = new Set();
  const unique = issues.filter((i) => {
    const key = `${i.where}|${i.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const names = (kind, f) => [...new Set(unique.filter((i) => i.kind === kind).map(f))].sort();
  return {
    stats,
    issues: unique,
    missingRpc: names('rpc', (i) => i.name),
    missingTables: names('table', (i) => i.table),
    missingColumns: names('column', (i) => `${i.table}.${i.column}`),
    argMismatches: unique.filter((i) => i.kind === 'rpc-args'),
  };
}
