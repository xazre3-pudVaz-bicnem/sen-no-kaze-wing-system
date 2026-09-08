/**
 * コラムの自動生成。GitHub Actions から毎日 1 回実行する。
 *
 *   node scripts/generate-column.ts             … 生成して公開（合格時のみ）
 *   node scripts/generate-column.ts --dry-run   … 生成するがファイルを書かない
 *   node scripts/generate-column.ts --slug xxx  … 計画の特定テーマを指定
 *   node scripts/generate-column.ts --model ... … モデル ID を上書き
 *
 * 安全のため、このスクリプトが書き込むのは content/column/ 配下と content/column-plan.json、
 * および docs/column-log.md だけ。固定ページ・商品データ・環境変数には触れない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { stringifyFrontmatter } from '../lib/column/frontmatter.ts';
import { loadAllColumnArticles, isValidSlug } from '../lib/column/loader.ts';
import { validateArticle } from '../lib/column/validate.ts';
import { COLUMN_CATEGORIES, type ColumnArticle } from '../lib/column/types.ts';

const ROOT = process.cwd();
const COLUMN_DIR = path.join(ROOT, 'content', 'column');
const PLAN_PATH = path.join(ROOT, 'content', 'column-plan.json');
const FACTS_PATH = path.join(ROOT, 'content', 'column-facts.json');
const CONFIG_PATH = path.join(ROOT, 'content', 'column-autopost.json');
const LOG_PATH = path.join(ROOT, 'docs', 'column-log.md');

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const DRY_RUN = flag('dry-run');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD（JST）

interface PlanItem {
  slug: string;
  title: string;
  category: string;
  question: string;
  difference: string;
  facts: string[];
  links: string[];
  auto: boolean;
  status: 'planned' | 'published' | 'draft';
}
interface Fact {
  id: string;
  topic: string;
  statement: string;
  source: string;
  sourceUrl?: string;
  checkedAt: string;
  status: 'confirmed' | 'needs-check';
}

/** 実行結果を1行のログに残す（失敗・見送り・成功が後から分かるように） */
function appendLog(status: 'published' | 'draft' | 'skipped' | 'failed', message: string) {
  const line = `| ${new Date().toISOString()} | ${status} | ${message.replace(/\|/g, '/')} |\n`;
  if (DRY_RUN) {
    console.log(`[dry-run] log: ${line.trim()}`);
    return;
  }
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '# コラム自動投稿の実行ログ\n\n| 実行時刻(UTC) | 結果 | 内容 |\n| --- | --- | --- |\n');
  }
  fs.appendFileSync(LOG_PATH, line);
}

function exit(code: number, status: 'published' | 'draft' | 'skipped' | 'failed', message: string): never {
  appendLog(status, message);
  console.log(`[${status}] ${message}`);
  process.exit(code);
}

// ---- 1. 設定と停止スイッチ ----------------------------------------------------
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as { enabled: boolean; model: string; maxOutputTokens: number; maxRetries: number };
if (process.env.COLUMN_AUTOPOST === 'off') exit(0, 'skipped', '環境変数 COLUMN_AUTOPOST=off のため停止');
if (!config.enabled) exit(0, 'skipped', 'content/column-autopost.json の enabled=false のため停止');

const MODEL = arg('model') ?? process.env.COLUMN_MODEL ?? config.model;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) exit(1, 'failed', 'ANTHROPIC_API_KEY が未設定');

// ---- 2. 二重投稿の防止 --------------------------------------------------------
const existing = loadAllColumnArticles();
const publishedToday = existing.filter((a) => a.publishedAt === today && a.generatedBy === 'auto');
if (publishedToday.length > 0 && !flag('force')) {
  exit(0, 'skipped', `本日（${today}）は既に自動投稿済み: ${publishedToday.map((a) => a.slug).join(', ')}`);
}

// ---- 3. テーマの選択 ----------------------------------------------------------
const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8')) as { items: PlanItem[] };
const facts = (JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8')) as { facts: Fact[] }).facts;
const existingSlugs = new Set(existing.map((a) => a.slug));

const wanted = arg('slug');
const candidates = plan.items.filter((p) => p.status === 'planned' && !existingSlugs.has(p.slug));
const target = wanted ? plan.items.find((p) => p.slug === wanted) : candidates.find((p) => p.auto);

if (!target) {
  const remaining = candidates.length;
  exit(0, 'skipped', remaining === 0 ? '記事計画に未公開テーマが無い（content/column-plan.json に追記してください）' : '自動公開可能なテーマが無い（auto:true の計画を追加してください）');
}
if (existingSlugs.has(target.slug)) exit(0, 'skipped', `slug が既存記事と重複: ${target.slug}`);
if (!isValidSlug(target.slug)) exit(1, 'failed', `計画の slug が不正: ${target.slug}`);

// ---- 4. プロンプト（全文ではなく索引・要約だけを渡してトークンを抑える） -------
const usableFacts = facts.filter((f) => target.facts.includes(f.id));
const confirmed = usableFacts.filter((f) => f.status === 'confirmed');
if (confirmed.length === 0) exit(0, 'skipped', `根拠となる confirmed の事実が無い: ${target.slug}`);

const articleIndex = existing
  .filter((a) => a.status === 'published')
  .map((a) => `- ${a.title}（${a.category} / ${a.slug}）: ${a.description}`)
  .join('\n');

const systemPrompt = [
  'あなたは折り畳み式木造コンテナを扱う日本の建設会社「株式会社技術の杜」（千の風プロジェクト）のオウンドメディア編集者です。',
  '導入を検討している読者の疑問を解決する記事を日本語で書きます。',
  '',
  '【厳守】',
  '- 与えられた「確認済み情報」に書かれていない数値・仕様・実績・価格・納期・耐久性・断熱性能を書かない。',
  '- 架空の施工事例、お客様の声、実績数、体験談、専門家の監修表記、出典URLを作らない。',
  '- 「必ず儲かる」「絶対に上位表示」のような保証表現を使わない。',
  '- 建築確認・用途地域・旅館業・民泊・税金・補助金・収益性は、断定せず「自治体や保健所への確認が必要」という形にとどめる。',
  '- 他サイトの文章を引用・言い換えしない。',
  '- 本文は Markdown。使ってよいのは ## / ### 見出し、段落、- 箇条書き、1. 番号付き、| 表 |、**強調**、[表示文](/内部パス) のみ。',
  '- HTML タグ、画像記法、スクリプトは書かない。リンクは指定された内部パスだけを使う。',
  '- H1（#）は書かない。記事タイトルはページ側が表示する。',
].join('\n');

const userPrompt = [
  `# 依頼`,
  `次のテーマでコラム記事の本文を書いてください。`,
  ``,
  `- タイトル案: ${target.title}`,
  `- カテゴリー: ${target.category}`,
  `- 読者の疑問: ${target.question}`,
  `- 他記事との違い（必ず守る）: ${target.difference}`,
  `- 本文で使ってよい内部リンク: ${target.links.join(' , ')}`,
  ``,
  `# 確認済み情報（これ以外の事実を書かない）`,
  ...confirmed.map((f) => `- [${f.topic}] ${f.statement}`),
  ...usableFacts.filter((f) => f.status === 'needs-check').map((f) => `- [要確認・断定禁止] ${f.topic}: ${f.statement}`),
  ``,
  `# 既存のコラム（テーマが重ならないようにする。本文は渡していません）`,
  articleIndex || '（まだありません）',
  ``,
  `# 出力形式`,
  `次の JSON だけを出力してください。前後に説明文やコードフェンスを付けないこと。`,
  `{"title":"...","description":"120文字以内の説明","body":"Markdown本文"}`,
  ``,
  `# 本文の条件`,
  `- 全角1,500〜2,500文字程度。水増ししない。`,
  `- 冒頭2段落で読者の疑問に答える。`,
  `- ## 見出しを4〜6個。必要なら ### と表を使う。`,
  `- 読後に使えるチェックリストを1つ含める。`,
  `- 最後の見出しは「## まとめ」にし、指定された内部リンクへ自然に誘導する。`,
].join('\n');

// ---- 5. API 呼び出し（回数制限つき再試行） ------------------------------------
interface ApiResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

async function callClaude(): Promise<ApiResult> {
  let lastError = '';
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
      const res = await fetch(base + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: config.maxOutputTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (res.status === 404 || res.status === 400) {
        // モデルが使えない場合に別モデルへ勝手に切り替えない
        throw new Error(`モデル ${MODEL} を利用できません（HTTP ${res.status}）: ${(await res.text()).slice(0, 300)}`);
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, attempt * 5000));
          continue;
        }
        throw new Error(lastError);
      }
      const json = (await res.json()) as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
      const text = json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      return { text, usage: json.usage };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (lastError.includes('を利用できません')) throw e;
      if (attempt === config.maxRetries) throw new Error(lastError);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw new Error(lastError);
}

let api: ApiResult;
try {
  api = await callClaude();
} catch (e) {
  exit(1, 'failed', `API 呼び出しに失敗: ${e instanceof Error ? e.message : String(e)}`);
}

// ---- 6. 出力の解析（信頼できない入力として扱う） ------------------------------
function extractJson(raw: string): { title: string; description: string; body: string } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.title !== 'string' || typeof parsed.description !== 'string' || typeof parsed.body !== 'string') return null;
    return { title: parsed.title, description: parsed.description, body: parsed.body };
  } catch {
    return null;
  }
}

const parsed = extractJson(api.text);
if (!parsed) exit(1, 'failed', `${target.slug}: モデル出力を JSON として解釈できなかった`);

/** 関連ページの表示名。パスをそのまま出さない */
function pageLabel(p: string): string {
  if (p === '/contact') return 'お問い合わせ';
  if (p === '/products') return '商品ラインナップ';
  if (p === '/dealers') return '代理店・工務店のご紹介';
  if (p.startsWith('/simulator')) return '見積シミュレーション';
  if (p.startsWith('/products/')) return '商品の詳細';
  if (p.startsWith('/#')) return 'トップページ';
  return 'サイト内のページ';
}

const category = (COLUMN_CATEGORIES as readonly string[]).includes(target.category) ? target.category : '基礎知識';
const sources = confirmed.map((f) => ({ label: `${f.source}（${f.topic}）`, checkedAt: f.checkedAt }));
const relatedPages = target.links
  .filter((p) => p.startsWith('/'))
  .map((p) => ({ label: pageLabel(p), path: p }));
const related = existing
  .filter((a) => a.status === 'published' && a.category === category)
  .slice(0, 2)
  .map((a) => a.slug);

const candidate: ColumnArticle = {
  slug: target.slug,
  title: parsed.title.trim() || target.title,
  description: parsed.description.trim(),
  category: category as ColumnArticle['category'],
  publishedAt: today,
  status: 'published',
  sources,
  related,
  relatedPages,
  generatedBy: 'auto',
  body: parsed.body,
};

// ---- 7. 検証（AI の自己申告ではなく機械的な条件で判定） ------------------------
const result = validateArticle(candidate, existing);
const tokens = `入力 ${api.usage.input_tokens} / 出力 ${api.usage.output_tokens} トークン`;

if (!result.ok) {
  exit(0, 'skipped', `${target.slug}: 品質不合格のため見送り（${tokens}）: ${result.errors.join(' / ')}`);
}

// 専門判断が必要な話題を含む、または計画で auto:false のものは下書き保存
const needsReview = result.reviewReasons.length > 0 || target.auto === false;
if (needsReview) candidate.status = 'draft';

if (DRY_RUN) {
  console.log(`[dry-run] ${candidate.status}: ${candidate.slug} / ${candidate.title}`);
  console.log(`[dry-run] ${tokens}`);
  if (result.warnings.length) console.log(`[dry-run] warnings: ${result.warnings.join(' / ')}`);
  if (needsReview) console.log(`[dry-run] 要確認: ${result.reviewReasons.join(', ') || '計画で auto:false'}`);
  exit(0, 'skipped', `dry-run（${tokens}）: ${candidate.slug}`);
}

// ---- 8. 保存（content/column 配下のみ） ---------------------------------------
const filePath = path.join(COLUMN_DIR, `${candidate.slug}.md`);
if (!path.resolve(filePath).startsWith(path.resolve(COLUMN_DIR))) exit(1, 'failed', 'ファイルパスが content/column の外を指している');
if (fs.existsSync(filePath)) exit(0, 'skipped', `ファイルが既に存在: ${candidate.slug}.md`);

const md = stringifyFrontmatter(
  {
    slug: candidate.slug,
    title: candidate.title,
    description: candidate.description,
    category: candidate.category,
    publishedAt: candidate.publishedAt,
    status: candidate.status,
    generatedBy: 'auto',
    related: candidate.related,
    relatedPages: candidate.relatedPages,
    sources: candidate.sources,
  },
  candidate.body
);
fs.mkdirSync(COLUMN_DIR, { recursive: true });
fs.writeFileSync(filePath, md, 'utf8');

// 計画の状態を更新（このファイルだけ書き換える）
const idx = plan.items.findIndex((p) => p.slug === target.slug);
if (idx >= 0) plan.items[idx].status = candidate.status === 'published' ? 'published' : 'draft';
fs.writeFileSync(PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

const reviewNote = needsReview ? `（要確認: ${result.reviewReasons.join(', ') || '計画で auto:false'}）` : '';
const warnNote = result.warnings.length ? `（警告: ${result.warnings.join(' / ')}）` : '';
exit(0, candidate.status === 'published' ? 'published' : 'draft', `${candidate.slug}: ${candidate.title}${reviewNote}${warnNote} ${tokens}`);

// 到達しない（exit は never）
export {};
