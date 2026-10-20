import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const VECTORS = path.join(REPO, 'tests', 'fixtures', 'pricing-v25-vectors.json');
const TS_ENGINE = path.join(REPO, 'lib', 'domain', 'pricing-v25.ts');
const FUZZ_SEED = 20261016;
const FUZZ_COUNT = 400;

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-pricing-v25.sql'), 'utf8').split('\r').join('');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    const results = rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    return { ok: results.length > 0 && results.every((item) => item.ok), results };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}

/** DB の正式計算。エラーは { error: 'VALIDATION' など } にする（savepoint で transaction を続ける） */
async function dbCalculate(client, calcRuleId, taxRuleId, input) {
  await client.query('savepoint pricing_v25_case');
  try {
    const res = await client.query('select public.pricing_calculate($1, $2, $3::jsonb) as r', [calcRuleId, taxRuleId, JSON.stringify(input)]);
    await client.query('release savepoint pricing_v25_case');
    return { value: res.rows[0].r };
  } catch (error) {
    await client.query('rollback to savepoint pricing_v25_case');
    return { error: String(error.message ?? '').split(':')[0], message: error.message };
  }
}

function tsCalculate(engine, rule, taxRule, input) {
  try {
    return { value: engine.calculatePricingV25(rule, taxRule, input) };
  } catch (error) {
    return { error: String(error.message ?? '').split(':')[0], message: error.message };
  }
}

/** 決まった種から同じ列を作る擬似乱数（mulberry32） */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateInput(next) {
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (items) => items[int(0, items.length - 1)];
  const decimal = (wholeMax, maxScale) => {
    const whole = int(0, wholeMax);
    const scale = int(0, maxScale);
    const fraction = scale ? '.' + Array.from({ length: scale }, () => int(0, 9)).join('') : '';
    return `${whole}${fraction}`;
  };
  // 率：多くは業務の範囲（販売費率 1〜1.5、掛率 1〜2.5、経費率 0〜0.3）、ときどき範囲外・小数 5 桁・数値で渡す
  const rate = (low, high) => {
    const roll = next();
    if (roll < 0.03) return `${low}.${int(10000, 99999)}`;
    if (roll < 0.05) return '0';
    const value = (low + next() * (high - low)).toFixed(int(0, 4));
    return next() < 0.3 ? Number(value) : value;
  };
  const codes = ['base', 'interior_exterior', 'option', 'sitework'];
  const sectionCount = int(0, 4);
  const chosen = [...codes].sort(() => next() - 0.5).slice(0, sectionCount);
  if (next() < 0.02 && chosen.length) chosen.push(chosen[0]); // ときどき区分の重複
  let keySeq = 0;
  const sections = chosen.map((code) => ({
    code,
    lines: Array.from({ length: int(0, 5) }, () => {
      // 別途工事は manual・por が主（auto はまれに入れて、DB・TypeScript とも拒否することを確かめる）
      const mode = code === 'sitework' ? pick(['manual', 'manual', 'manual', 'por', 'por', next() < 0.2 ? 'auto' : 'manual']) : pick(['auto', 'auto', 'auto', 'manual', 'manual', 'por']);
      const quantity = next() < 0.02 ? decimal(10, 5) : next() < 0.3 ? int(0, 20) : decimal(50, 4);
      const key = next() < 0.01 && keySeq > 0 ? `k${keySeq}` : `k${++keySeq}`; // ときどきキーの重複
      if (mode === 'auto') {
        const standardCost = next() < 0.05 ? int(0, 2147483647) : int(0, 5000000);
        const line = { key, mode, quantity, standard_cost: standardCost };
        if (next() < 0.6) line.variant_adjustment = next() < 0.05 ? -(standardCost + int(1, 1000)) : int(-200000, 200000);
        return line;
      }
      if (mode === 'manual') return { key, mode, quantity, manual_unit_price: next() < 0.03 ? int(0, 2147483647) : int(0, 3000000) };
      return { key, mode, quantity };
    }),
  }));
  const input = {
    rates: { sales_fee_rate: rate(1, 1.5), markup_rate: rate(1, 2.5), expense_rate: rate(0, 0.3) },
    sections,
  };
  if (next() < 0.5) input.adjustment = next() < 0.1 ? -int(0, 50000000) : int(-100000, 100000);
  return input;
}

export async function runtimePricingV25(client) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok) return single;

  const results = [];
  const push = (step, expected, actual, ok) => results.push({ step, expected, actual, ok });

  let engine;
  try {
    engine = await import(pathToFileURL(TS_ENGINE).href);
  } catch (error) {
    push('TypeScript の正式計算を node から読み込める（Node 22.18 以上の型の除去が必要）', 'import success', error.message, false);
    return { ok: false, results: [...single.results, ...results] };
  }

  const fixture = JSON.parse(fs.readFileSync(VECTORS, 'utf8'));
  try {
    await client.query('begin');
    const calc = (await client.query(
      `select id, formula_code, rounding_mode, expense_target_sections, auto_price_sections from public.pricing_calculation_rule_versions where superseded_at is null`
    )).rows[0];
    const tax = (await client.query(
      `select id, tax_mode, tax_rate::text as tax_rate, rounding_mode from public.tax_rule_versions where superseded_at is null`
    )).rows[0];

    // テストベクトルの「別途工事も経費・自動計算の対象にする」ルールは、閉じた（過去の）Version として足す（rollback で消える）
    const allSections = (await client.query(
      `insert into public.pricing_calculation_rule_versions
         (code, version_no, formula_code, rounding_mode, expense_target_sections, auto_price_sections, description, created_at, superseded_at, superseded_by_version_id)
       values ('CALC-TEST-ALL', 99, 'v2.5', 'trunc', $1::text[], $2::text[], 'テストベクトル用', now() - interval '1 day', now() - interval '1 hour', $3)
       returning id, formula_code, rounding_mode, expense_target_sections, auto_price_sections`,
      [fixture.rules.all_sections.expense_target_sections, fixture.rules.all_sections.auto_price_sections, calc.id]
    )).rows[0];
    const rules = { standard: calc, all_sections: allSections };

    const sameRules =
      isDeepStrictEqual(
        { formula_code: calc.formula_code, rounding_mode: calc.rounding_mode, expense_target_sections: calc.expense_target_sections, auto_price_sections: calc.auto_price_sections },
        fixture.rules.standard
      ) && isDeepStrictEqual({ tax_mode: tax.tax_mode, tax_rate: tax.tax_rate, rounding_mode: tax.rounding_mode }, fixture.tax);
    push('DB の現在の計算ルール・税ルールはテストベクトルの前提と同じ', 'same', sameRules ? 'same' : JSON.stringify({ calc, tax }), sameRules);

    // 1. 手で検算したテストベクトル：DB の結果が期待値と一致する（TypeScript 側は tests/pricing-v25.test.ts が確かめる）
    for (const vector of fixture.vectors) {
      const rule = rules[vector.rule];
      const db = await dbCalculate(client, rule.id, tax.id, vector.input);
      if (vector.error) {
        push(`ベクトル：${vector.name}`, `拒否（${vector.error}）`, db.error ? `拒否（${db.error}）` : 'success', db.error === vector.error);
        continue;
      }
      const expected = { formula_code: 'v2.5', calc_rule_version_id: rule.id, tax_rule_version_id: tax.id, ...vector.expected };
      const ok = !db.error && isDeepStrictEqual(db.value, expected);
      push(`ベクトル：${vector.name}`, 'expected と一致', ok ? 'expected と一致' : JSON.stringify(db.error ? db : db.value), ok);
    }

    // 2. 決まった種のランダムな入力で、DB と TypeScript の結果（エラーの種類を含む）が一致する
    const next = random(FUZZ_SEED);
    let mismatches = 0;
    let errors = 0;
    let porCases = 0;
    let firstMismatch = null;
    for (let i = 0; i < FUZZ_COUNT; i += 1) {
      const input = generateInput(next);
      const db = await dbCalculate(client, calc.id, tax.id, input);
      const ts = tsCalculate(engine, calc, tax, input);
      if (db.error) errors += 1;
      if (db.value?.has_por) porCases += 1;
      const same = db.error || ts.error ? db.error === ts.error : isDeepStrictEqual(db.value, ts.value);
      if (!same) {
        mismatches += 1;
        firstMismatch ??= { index: i, input, db, ts };
      }
    }
    push(`DB と TypeScript がランダムな入力 ${FUZZ_COUNT} 件で一致する（エラー ${errors} 件・por ${porCases} 件を含む）`, '不一致 0 件',
      mismatches === 0 ? '不一致 0 件' : `不一致 ${mismatches} 件：${JSON.stringify(firstMismatch).slice(0, 1500)}`, mismatches === 0);
    push('ランダムな入力に、計算できる場合・エラー・por がどれも含まれる', 'true',
      String(errors > 0 && porCases > 0 && FUZZ_COUNT - errors - porCases > 0), errors > 0 && porCases > 0 && FUZZ_COUNT - errors - porCases > 0);
  } catch (error) {
    push('正式計算の突き合わせを最後まで実行できる', 'success', error.message, false);
  } finally {
    await client.query('rollback').catch(() => {});
  }

  return { ok: results.every((item) => item.ok), results: [...single.results, ...results] };
}
