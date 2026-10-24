import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb, saveDb } from '@/lib/data/local-db';
import type { SessionUser } from '@/lib/data/store';
import {
  UNRESOLVED_LINES_MESSAGE,
  applyQuoteLineStateInput,
  applyQuoteLineStates,
  chooseQuoteLineState,
  lineStateReasonSeed,
  parsePorSelectionKeys,
  quoteOptionFlagMap,
  configurationPorSelections,
  findUnresolvedLines,
  isUnresolvedQuoteLine,
  parseQuoteLineState,
  porSelectionLabel,
  quoteLineStateAmountLabel,
  quoteLineStateGuardError,
  samePorSelectionKeys,
  splitQuoteLineStateRemark,
  unconfirmedPorSelectionsError,
  unresolvedLinesError,
  type PorSelectionCatalog,
  type QuoteLineCheckInput,
  type QuoteLineCheckLine,
} from '@/lib/domain/quote-por';
import type { Configuration, ConfigurationItem, Quote, QuoteItem, QuoteRequest } from '@/lib/domain/types';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016111000_quote_formal_por_guard.sql'), 'utf8');

describe('金額未確定の明細（SQL の quote_line_unresolved と同じ決まり。2026-10-22 の確定事項 A-2-1）', () => {
  it('実 DB の検査（QPG-1）と同じ組み合わせで同じ結果になる', () => {
    const cases: [QuoteLineCheckInput, boolean][] = [
      // 別途見積の目印がある 0 円の行は、前の版から変えていなくても未確定
      [{ kind: 'option', unit_price: 0, description: '設置場所確認後に別途お見積り' }, true],
      [{ kind: 'option', unit_price: 0, description: '設置場所確認後に別途お見積り', unchangedZero: true }, true],
      [{ kind: 'installation', unit_price: 0, remark: '別途見積' }, true],
      [{ kind: 'installation', unit_price: 0, remark: ' 別途見積 ' }, true],
      [{ kind: 'interior_exterior', unit_price: 0, remark: '価格未確定（別途お見積り）' }, true],
      [{ kind: 'interior_exterior', unit_price: 0, remark: '別途見積項目あり・見積発行時点の面別外壁仕様' }, true],
      [{ kind: 'option', unit_price: 0, optionIsPor: true }, true],
      // 自由記述の備考の文章では解消しない（状態を推測しない）
      [{ kind: 'option', unit_price: 0, description: '設置場所確認後に別途お見積り', remark: '電気設備工事に含む' }, true],
      [{ kind: 'option', unit_price: 0, remark: 'サービス', optionIsPor: true }, true],
      [{ kind: 'installation', unit_price: 0, remark: 'サービス' }, true],
      // 明示の状態（対象外・0円確定）は解消
      [{ kind: 'option', unit_price: 0, description: '設置場所確認後に別途お見積り', remark: '［今回の契約対象外］' }, false],
      [{ kind: 'installation', unit_price: 0, remark: '［今回の契約対象外］お客様手配' }, false],
      [{ kind: 'option', unit_price: 0, remark: '［0円確定］：電気設備工事に含む', optionIsPor: true }, false],
      // 理由のない 0円確定 の書き出しは状態ではない（表の保存境界でも拒否する）
      [{ kind: 'installation', unit_price: 0, remark: '［0円確定］：' }, true],
      // 金額が入っていれば確定
      [{ kind: 'option', unit_price: 5000, description: '設置場所確認後に別途お見積り' }, false],
      [{ kind: 'interior_exterior', unit_price: 1000, remark: '別途見積項目あり・見積発行時点の面別外壁仕様' }, false],
      // 0 円の内外装・オプション・別途工事・フリー商品：台帳の 0 円の商品・自動計算・前の版と同じ 0 円の明細だけはそのまま
      [{ kind: 'option', unit_price: 0, optionIsCatalogZero: true }, false],
      [{ kind: 'option', unit_price: 0, calculated: true }, false],
      [{ kind: 'installation', unit_price: 0, unchangedZero: true }, false],
      [{ kind: 'installation', unit_price: 0 }, true],
      [{ kind: 'free', unit_price: 0 }, true],
      [{ kind: 'interior_exterior', unit_price: 0 }, true],
      // 本体・経費・値引きの行は対象外
      [{ kind: 'base', unit_price: 0 }, false],
      [{ kind: 'base_expense', unit_price: 0 }, false],
      [{ kind: 'interior_exterior_expense', unit_price: 0 }, false],
      [{ kind: 'option_expense', unit_price: 0 }, false],
      [{ kind: 'discount', unit_price: 0 }, false],
    ];
    expect(cases.map(([line]) => isUnresolvedQuoteLine(line))).toEqual(cases.map(([, expected]) => expected));
  });

  it('前後の空白は SQL の btrim と同じく半角スペースだけを取り除く（全角スペースつきは目印ではないが、0 円の行なので未確定）', () => {
    expect(isUnresolvedQuoteLine({ kind: 'base', unit_price: 0, remark: '  別途見積' })).toBe(true);
    expect(isUnresolvedQuoteLine({ kind: 'base', unit_price: 0, remark: '　別途見積' })).toBe(false);
    expect(isUnresolvedQuoteLine({ kind: 'base', unit_price: 0, description: ' 設置場所確認後に別途お見積り ', remark: '  ' })).toBe(true);
  });

  it('前の版との突き合わせ：区分・品名・説明が同じ 0 円の明細（印なし・別途見積の目印なし）だけ。下書きは明細のキーも', () => {
    const parentLines = [
      { kind: 'installation', name: '養生', description: null, remark: null, unit_price: 0 },
      { kind: 'installation', name: '電気設備工事', description: null, remark: null, unit_price: 80_000 },
      { kind: 'option', name: '照明', description: '設置場所確認後に別途お見積り', remark: null, unit_price: 0 },
      { kind: 'installation', name: '給排水', description: null, remark: '［今回の契約対象外］', unit_price: 0 },
      { kind: 'option', name: '特注の棚', description: null, remark: null, unit_price: 0, option_id: 'o-por' },
    ];
    const options = new Map([
      ['o-por', { price: 0, price_on_request: true }],
      ['o-zero', { price: 0, price_on_request: false }],
    ]);
    // 1 行ずつ確かめる（同じ明細を並べたときの数え方は次のテスト）
    const check = (line: QuoteLineCheckLine) => findUnresolvedLines([line], { parentLines, options }).has(line);
    expect(check({ kind: 'installation', name: '養生', description: null, unit_price: 0 })).toBe(false);
    expect(check({ kind: 'installation', name: '養生', description: '変更', unit_price: 0 })).toBe(true);
    expect(check({ kind: 'free', name: '養生', unit_price: 0 })).toBe(true);
    // 0 円に変えた明細・新しく足した 0 円の行
    expect(check({ kind: 'installation', name: '電気設備工事', unit_price: 0 })).toBe(true);
    expect(check({ kind: 'installation', name: '追加の運搬', unit_price: 0 })).toBe(true);
    // 前の版で別途見積・対象外だった明細は、0 円のまま引き継いでも未確定
    expect(check({ kind: 'option', name: '照明', description: '設置場所確認後に別途お見積り', unit_price: 0 })).toBe(true);
    expect(check({ kind: 'installation', name: '給排水', unit_price: 0 })).toBe(true);
    expect(check({ kind: 'option', name: '特注の棚', unit_price: 0 })).toBe(true);
    // 台帳の 0 円の商品・編集中の明示の選択
    expect(check({ kind: 'option', name: '無償の部材', unit_price: 0, option_id: 'o-zero' })).toBe(false);
    expect(check({ kind: 'installation', name: '追加の運搬', unit_price: 0, line_state: 'excluded' })).toBe(false);

    const draftCheck = (line: QuoteLineCheckLine) =>
      findUnresolvedLines([line], {
        parentLines: [{ line_key: 'k1', kind: 'installation', name: '養生', remark: null, unit_price: 0 }],
        matchLineKey: true,
      }).has(line);
    expect(draftCheck({ line_key: 'k1', kind: 'installation', name: '養生', unit_price: 0 })).toBe(false);
    expect(draftCheck({ line_key: 'k2', kind: 'installation', name: '養生', unit_price: 0 })).toBe(true);
    expect(draftCheck({ line_key: null, kind: 'installation', name: '養生', unit_price: 0 })).toBe(true);
    // 標準見積から作る下書き：保存のたびに作り直す経費の行は外す。自動計算でも原価 0 円で売価 0 円の行は、ほかの 0 円の行と同じ
    expect(draftCheck({ line_key: 'k3', kind: 'installation', name: '別途工事経費', unit_price: 0, price_mode: 'auto', line_role: 'expense' })).toBe(false);
    expect(draftCheck({ line_key: 'k3', kind: 'option', name: '洗面器', unit_price: 0, price_mode: 'auto', line_role: 'line' })).toBe(true);
    expect(draftCheck({ line_key: 'k3', kind: 'option', name: '洗面器', unit_price: 0, price_mode: 'manual' })).toBe(true);
  });

  it('前の版の同じ 0 円の明細は、前の版の行の数までしか「変えていない」とみなさない（実 DB の QPG-22・35・59・60 と同じ）', () => {
    const parentLines = [{ kind: 'installation', name: '養生', description: null, remark: null, unit_price: 0 }];
    const first = { kind: 'installation', name: '養生', description: null, remark: null, unit_price: 0 };
    const second = { kind: 'installation', name: '養生', description: null, remark: null, unit_price: 0 };
    // 同じ明細をもう 1 行足すと、後ろの 1 行が未確定
    expect([...findUnresolvedLines([first, second], { parentLines })]).toEqual([second]);
    // 対象外の行（印あり・画面の選択）は数に入れない
    const excluded = { kind: 'installation', name: '養生', description: null, remark: '［今回の契約対象外］', unit_price: 0 };
    const chosen = { ...second, remark: null, line_state: 'excluded' as const };
    expect(findUnresolvedLines([excluded, first], { parentLines }).size).toBe(0);
    expect(findUnresolvedLines([chosen, first], { parentLines }).size).toBe(0);
    // 金額の入った同じ品名の行も数に入れない
    expect(findUnresolvedLines([{ ...second, unit_price: 5000 }, first], { parentLines }).size).toBe(0);
    // 前の版にも 2 行あれば、2 行ともそのまま
    expect(findUnresolvedLines([first, second], { parentLines: [...parentLines, { ...parentLines[0] }] }).size).toBe(0);
    // 下書きは明細のキーごと（同じキーの行は下書きの中で 1 つだけ）
    const draftParent = [{ line_key: 'k1', kind: 'installation', name: '養生', remark: null, unit_price: 0 }];
    const kept = { line_key: 'k1', kind: 'installation', name: '養生', unit_price: 0 };
    const added = { line_key: 'k9', kind: 'installation', name: '養生', unit_price: 0 };
    expect([...findUnresolvedLines([kept, added], { parentLines: draftParent, matchLineKey: true })]).toEqual([added]);
    // 改訂の明細は台帳の紐付けを残さない：新しい版の行の option_id は見ず、前の版の行は台帳で別途見積かを見る
    const options = quoteOptionFlagMap([
      { id: 'o-zero', price: 0, priceOnRequest: false },
      { id: 'o-por', price: 0, priceOnRequest: true },
    ]);
    const catalogZero = { kind: 'option', name: '無償の部材', unit_price: 0, option_id: 'o-zero' };
    expect(findUnresolvedLines([catalogZero], { options }).size).toBe(0);
    expect(findUnresolvedLines([catalogZero], { options, ignoreLineOptions: true }).size).toBe(1);
    const porParent = [{ kind: 'option', name: '特注の棚', remark: null, unit_price: 0, option_id: 'o-por' }];
    const copied = { kind: 'option', name: '特注の棚', unit_price: 0, option_id: null };
    expect(findUnresolvedLines([copied], { parentLines: porParent, options, ignoreLineOptions: true }).size).toBe(1);
    expect(findUnresolvedLines([copied], { parentLines: porParent, ignoreLineOptions: true }).size).toBe(0);
    expect(migration).toContain('row_number() over (partition by l.kind, l.name_key, l.description_key order by l.sort_order, l.id) as seq');
    expect(migration).toContain('partition by case when v_parent is not null then l.line_key end, l.kind, l.name_key, l.description_key');
    expect(migration.match(/where c\.seq > coalesce\(z\.line_count, 0\)/g)).toHaveLength(2);
  });

  it('標準見積から作った初回の下書きは、元の標準見積の版の 0 円の行と区分・品名・説明で突き合わせる（版の行の数まで。実 DB の QPG と同じ）', () => {
    const baselineLines = [{ kind: 'installation', name: '標準の0円の工事', description: null, remark: null, unit_price: 0 }];
    const standard = { line_key: 'k1', kind: 'installation', name: '標準の0円の工事', unit_price: 0, price_mode: 'auto', line_role: 'line' };
    const expense = { line_key: 'k2', kind: 'installation', name: '別途工事経費', unit_price: 0, price_mode: 'auto', line_role: 'expense' };
    const added = { line_key: 'k3', kind: 'installation', name: '追加の運搬', unit_price: 0, price_mode: 'auto', line_role: 'line' };
    const duplicate = { ...standard, line_key: 'k4' };
    expect(findUnresolvedLines([standard, expense], { baselineLines, matchLineKey: true }).size).toBe(0);
    expect([...findUnresolvedLines([standard, expense, added], { baselineLines, matchLineKey: true })]).toEqual([added]);
    expect([...findUnresolvedLines([standard, duplicate], { baselineLines, matchLineKey: true })]).toEqual([duplicate]);
    // 品名・説明の前後の半角スペースは SQL の btrim と同じく除いて比べる（全角スペースは除かない）
    expect(findUnresolvedLines([{ ...standard, name: ' 標準の0円の工事 ' }], { baselineLines, matchLineKey: true }).size).toBe(0);
    expect(findUnresolvedLines([{ ...standard, name: '標準の0円の工事　' }], { baselineLines, matchLineKey: true }).size).toBe(1);
    expect(migration).toContain("i.price_mode = 'auto' and coalesce(c.line_role, 'line') = 'expense', false) as unresolved_alone");
    expect(migration).toContain('from public.standard_estimate_revision_lines s');
    expect(migration).toContain("and ((s.price_mode = 'auto' and coalesce(s.cost_unit_price, 0) = 0) or (s.price_mode = 'manual' and coalesce(s.unit_price, 0) = 0))");
  });

  it('目印・状態の印の文言は migration と同じ', () => {
    expect(migration).toContain(`btrim(coalesce(p_remark, '')) in ('別途見積', '価格未確定（別途お見積り）')`);
    expect(migration).toContain(`btrim(coalesce(p_remark, '')) like '別途見積項目あり%'`);
    expect(migration).toContain(`btrim(coalesce(p_description, '')) = '設置場所確認後に別途お見積り'`);
    expect(migration).toContain(`when coalesce(p_remark, '') like '［今回の契約対象外］%' then 'excluded'`);
    expect(migration).toContain(`when coalesce(p_remark, '') ~ '^［0円確定］：\\s*\\S' then 'zero_confirmed'`);
    expect(migration).toContain(`when p_kind in ('base', 'base_expense', 'interior_exterior_expense', 'option_expense', 'discount') then false`);
  });

  it('止めたときの文面は DB と同じ', () => {
    expect(migration).toContain(`金額が未確定の明細が % 行残っています（%）。${UNRESOLVED_LINES_MESSAGE}`);
    expect(migration).toContain(`金額が未確定の明細が % 行残っています（%）。${UNRESOLVED_LINES_MESSAGE.replace('発行してください', '正式保存してください')}`);
    expect(unresolvedLinesError(['照明', 'テーブル'])).toBe(`金額が未確定の明細が 2 行残っています（照明、テーブル）。${UNRESOLVED_LINES_MESSAGE}`);
    expect(unresolvedLinesError(['照明'], '正式保存')).toMatch(/明細から外してから正式保存してください$/);
    expect(unconfirmedPorSelectionsError([{ key: 'product:x', option_id: 'x', name: '照明', detail: null }])).toBe(
      'お客様が選んだ別途見積の商品（1 件：照明）について、金額を明細に入れたか、「0円確定」「対象外」にしたか、お客様と合意のうえ外したことの確認が済んでいません。画面の「金額未確定の確認」で確認してから発行してください'
    );
    expect(migration).toContain(
      'について、金額を明細に入れたか、「0円確定」「対象外」にしたか、お客様と合意のうえ外したことの確認が済んでいません。画面の「金額未確定の確認」で確認してから発行してください'
    );
  });
});

describe('明細の状態の印（画面の明示の選択から、サーバーだけが付ける）', () => {
  it('対象外はメモ任意、0円確定は理由が必要。どちらも 0 円の内外装・オプション・別途工事・フリー商品の行だけ', () => {
    expect(applyQuoteLineStateInput({ kind: 'installation', name: '給排水', unit_price: 0, line_state: 'excluded' })).toBe('［今回の契約対象外］');
    expect(applyQuoteLineStateInput({ kind: 'installation', name: '給排水', unit_price: 0, line_state: 'excluded', line_state_reason: ' お客様手配 ' })).toBe(
      '［今回の契約対象外］お客様手配'
    );
    expect(applyQuoteLineStateInput({ kind: 'option', name: '照明', unit_price: 0, line_state: 'zero_confirmed', line_state_reason: '電気設備工事に含む' })).toBe(
      '［0円確定］：電気設備工事に含む'
    );
    expect(() => applyQuoteLineStateInput({ kind: 'option', name: '照明', unit_price: 0, line_state: 'zero_confirmed', line_state_reason: '  ' })).toThrow(
      '0円確定の明細は理由を入力してください'
    );
    expect(() => applyQuoteLineStateInput({ kind: 'option', name: '照明', unit_price: 5000, line_state: 'excluded' })).toThrow('0 円にしてください');
    expect(() => applyQuoteLineStateInput({ kind: 'base', name: '本体', unit_price: 0, line_state: 'excluded' })).toThrow('本体・経費の明細');
    expect(() => applyQuoteLineStateInput({ kind: 'option_expense', name: '諸費用', unit_price: 0, line_state: 'zero_confirmed', line_state_reason: 'x' })).toThrow(
      '本体・経費の明細'
    );
    expect(() => applyQuoteLineStateInput({ kind: 'installation', name: '給排水', unit_price: 0, line_state: 'excluded', line_state_reason: 'あ'.repeat(191) })).toThrow(
      '190 文字以内'
    );
  });

  it('備考に印を直接書いたものは受け付けない（状態は画面の選択だけで決める）。普通の備考はそのまま', () => {
    expect(() => applyQuoteLineStateInput({ name: '給排水', unit_price: 0, remark: '［今回の契約対象外］' })).toThrow('画面の選択で設定してください');
    expect(() => applyQuoteLineStateInput({ name: '照明', unit_price: 0, remark: '［0円確定］：サービス' })).toThrow('画面の選択で設定してください');
    expect(() => applyQuoteLineStateInput({ name: '照明', unit_price: 0, remark: '［0円確定］' })).toThrow('画面の選択で設定してください');
    expect(applyQuoteLineStateInput({ name: '照明', unit_price: 0, remark: ' 別途見積 ' })).toBe('別途見積');
    expect(applyQuoteLineStateInput({ name: '照明', unit_price: 0, remark: '' })).toBeNull();
    // 文中の［今回の契約対象外］は印ではない
    expect(applyQuoteLineStateInput({ name: '照明', unit_price: 1000, remark: '前回は［今回の契約対象外］' })).toBe('前回は［今回の契約対象外］');
  });

  it('保存する明細の配列では line_state を備考の印に置き換え、line_state の項目は送らない', () => {
    const rows = applyQuoteLineStates([
      { kind: 'installation', name: '給排水', unit_price: 0, remark: '見積中', quantity: 1, line_state: 'excluded' as const, line_state_reason: '' },
      { kind: 'installation', name: '電気', unit_price: 80_000, remark: '', quantity: 1, line_state: null, line_state_reason: '' },
    ]);
    expect(rows).toEqual([
      { kind: 'installation', name: '給排水', unit_price: 0, remark: '［今回の契約対象外］', quantity: 1 },
      { kind: 'installation', name: '電気', unit_price: 80_000, remark: null, quantity: 1 },
    ]);
  });

  it('印の読み取り・編集画面での分け方・金額欄の文言', () => {
    expect(parseQuoteLineState('［今回の契約対象外］お客様手配')).toEqual({ state: 'excluded', reason: 'お客様手配' });
    expect(parseQuoteLineState('［0円確定］：本体工事に含む')).toEqual({ state: 'zero_confirmed', reason: '本体工事に含む' });
    // 対象外のメモは書いたとおり（読み書きしても変わらない）
    expect(parseQuoteLineState('［今回の契約対象外］：お客様手配')).toEqual({ state: 'excluded', reason: '：お客様手配' });
    expect(parseQuoteLineState('［0円確定］：')).toBeNull();
    expect(parseQuoteLineState('別途見積')).toBeNull();
    expect(splitQuoteLineStateRemark('［0円確定］：本体工事に含む')).toEqual({ line_state: 'zero_confirmed', line_state_reason: '本体工事に含む', remark: '' });
    expect(splitQuoteLineStateRemark('別途見積')).toEqual({ line_state: null, line_state_reason: '', remark: '別途見積' });
    expect(splitQuoteLineStateRemark(null)).toEqual({ line_state: null, line_state_reason: '', remark: '' });
    expect(quoteLineStateAmountLabel('［今回の契約対象外］')).toBe('対象外');
    expect(quoteLineStateAmountLabel('［0円確定］：サービス')).toBe('0円確定');
    expect(quoteLineStateAmountLabel('サービス')).toBeNull();
  });

  it('編集画面で扱いを選ぶと 0 円にし、理由・メモが空なら今の備考を入れておく（別途見積の目印は入れない）。外すと備考は元のまま', () => {
    const row = { remark: 'Panasonic ／ XYZ-1', unit_price: 12_000, line_state: null, line_state_reason: '' };
    expect(chooseQuoteLineState(row, 'excluded')).toEqual({ remark: 'Panasonic ／ XYZ-1', unit_price: 0, line_state: 'excluded', line_state_reason: 'Panasonic ／ XYZ-1' });
    expect(chooseQuoteLineState({ ...row, line_state_reason: '入力済み' }, 'zero_confirmed').line_state_reason).toBe('入力済み');
    expect(chooseQuoteLineState({ ...row, remark: '別途見積' }, 'zero_confirmed').line_state_reason).toBe('');
    expect(chooseQuoteLineState({ ...row, line_state: 'excluded' as const, unit_price: 0 }, null)).toEqual({ ...row, unit_price: 0 });
    // 保存済みの印の行（備考は空・メモあり）で扱いを外すと、メモを備考へ戻す
    expect(chooseQuoteLineState({ remark: '', unit_price: 0, line_state: 'excluded' as const, line_state_reason: 'お客様手配' }, null)).toEqual({
      remark: 'お客様手配',
      unit_price: 0,
      line_state: null,
      line_state_reason: 'お客様手配',
    });
    expect(lineStateReasonSeed('価格未確定（別途お見積り）')).toBe('');
    expect(lineStateReasonSeed('別途見積項目あり・見積発行時点の面別外壁仕様')).toBe('');
    expect(lineStateReasonSeed('［今回の契約対象外］')).toBe('');
    expect(lineStateReasonSeed('あ'.repeat(200))).toHaveLength(190);
  });

  it('画面が送った別途見積の一覧の key の読み取り（形が違えば null）', () => {
    expect(parsePorSelectionKeys(null)).toEqual([]);
    expect(parsePorSelectionKeys('')).toEqual([]);
    expect(parsePorSelectionKeys('["product:a","face:front:b"]')).toEqual(['product:a', 'face:front:b']);
    expect(parsePorSelectionKeys('{"a":1}')).toBeNull();
    expect(parsePorSelectionKeys('[""]')).toBeNull();
    expect(parsePorSelectionKeys('[1]')).toBeNull();
    expect(parsePorSelectionKeys('not json')).toBeNull();
  });

  it('表の保存境界（DB の quote_line_state_guard と同じ）：印のある行は 0 円、0円確定は理由あり、価格の決め方は「金額を入力」', () => {
    expect(quoteLineStateGuardError({ name: '給排水', remark: '［今回の契約対象外］', unit_price: 0, amount: 0 })).toBeNull();
    expect(quoteLineStateGuardError({ name: '給排水', remark: '［今回の契約対象外］', unit_price: 1000, amount: 1000 })).toContain('0 円にしてください');
    expect(quoteLineStateGuardError({ name: '照明', remark: '［0円確定］', unit_price: 0, amount: 0 })).toContain('理由を入力してください');
    expect(quoteLineStateGuardError({ name: '照明', remark: '［0円確定］：サービス', unit_price: 0, amount: 0, price_mode: 'auto' })).toContain('金額を入力');
    expect(quoteLineStateGuardError({ name: '照明', remark: 'サービス', unit_price: 0, amount: 0, price_mode: 'auto' })).toBeNull();
    expect(migration).toContain(`raise exception 'VALIDATION: 「対象外」「0円確定」の明細（%）は 0 円にしてください'`);
    expect(migration).toContain(`raise exception 'VALIDATION: 0円確定の明細（%）は理由を入力してください'`);
  });
});

describe('お客様が選んだ別途見積の商品（SQL の configuration_por_selections と同じ）', () => {
  const catalog: PorSelectionCatalog = {
    options: [
      { id: 'o-por', name: '検査の別途見積の商品', category_id: 'c-items', price_on_request: true, sort_order: 1 },
      { id: 'o-plain', name: '検査の通常の商品', category_id: 'c-items', price_on_request: false, sort_order: 2 },
      { id: 'o-ext', name: '検査の外壁', category_id: 'c-ext', price_on_request: false, sort_order: 1 },
      { id: 'o-ext-por', name: '別途見積の外壁', category_id: 'c-ext', price_on_request: true, sort_order: 2 },
    ],
    categories: [
      { id: 'c-items', code: 'runtime-qpg-items', sort_order: 1 },
      { id: 'c-ext', code: 'exterior-wall', sort_order: 0 },
    ],
    variantGroups: [
      { id: 'g-plain', option_id: 'o-plain', name: '色', sort_order: 1 },
      { id: 'g-ext', option_id: 'o-ext', name: '塗装', sort_order: 1 },
    ],
    variantChoices: [
      { id: 'vc-plain', group_id: 'g-plain', name: '白', price_on_request: false, sort_order: 1 },
      { id: 'vc-por', group_id: 'g-plain', name: '特注色', price_on_request: true, sort_order: 2 },
      { id: 'e-plain', group_id: 'g-ext', name: '標準', price_on_request: false, sort_order: 1 },
      { id: 'e-por', group_id: 'g-ext', name: '特注塗装', price_on_request: true, sort_order: 2 },
    ],
  };
  const faces = [
    { face_code: 'front' as const, option_id: 'o-ext', variant_choice_ids: ['e-por'] },
    { face_code: 'right' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
    { face_code: 'back' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
    { face_code: 'left' as const, option_id: 'o-ext', variant_choice_ids: ['e-plain'] },
  ];

  it('商品・選択肢・外壁の面の順に並べ、外壁を面で選んだときの外壁の商品の明細は面として数える（実 DB の検査 QPG-2 と同じ）', () => {
    const selections = configurationPorSelections(
      {
        items: [
          { option_id: 'o-plain', variant_choice_ids: ['vc-por'] },
          { option_id: 'o-por', variant_choice_ids: [] },
          { option_id: 'o-ext-por', variant_choice_ids: [] },
        ],
        exteriorFaces: faces,
      },
      catalog
    );
    expect(selections.map((s) => `${s.key}|${s.name}|${s.detail ?? ''}`)).toEqual([
      'product:o-por|検査の別途見積の商品|',
      'variant:o-plain:vc-por|検査の通常の商品|色：特注色',
      'face:front:o-ext|検査の外壁|外壁（正面）：塗装：特注塗装',
    ]);
    expect(selections.map(porSelectionLabel)).toEqual(['検査の別途見積の商品', '検査の通常の商品（色：特注色）', '検査の外壁（外壁（正面）：塗装：特注塗装）']);
  });

  it('面を選んでいない構成では、外壁の商品も商品として数える。別途見積を選んでいなければ空', () => {
    expect(configurationPorSelections({ items: [{ option_id: 'o-ext-por' }] }, catalog).map((s) => s.key)).toEqual(['product:o-ext-por']);
    expect(configurationPorSelections({ items: [{ option_id: 'o-plain', variant_choice_ids: ['vc-plain'] }] }, catalog)).toEqual([]);
    // ほかの商品の選択肢は数えない
    expect(configurationPorSelections({ items: [{ option_id: 'o-por', variant_choice_ids: ['e-por'] }] }, catalog).map((s) => s.key)).toEqual(['product:o-por']);
  });

  it('画面に出した一覧と今の一覧の比べ方は、順番・重複を問わない', () => {
    const current = [
      { key: 'b', option_id: 'x', name: 'x', detail: null },
      { key: 'a', option_id: 'x', name: 'x', detail: null },
    ];
    expect(samePorSelectionKeys(['a', 'b'], current)).toBe(true);
    expect(samePorSelectionKeys(['b', 'a', 'a'], current)).toBe(true);
    expect(samePorSelectionKeys(['a'], current)).toBe(false);
    expect(samePorSelectionKeys(['a', 'b', 'c'], current)).toBe(false);
  });
});


describe('ローカル検証モードの改訂（確定見積）でも同じ止めをする', () => {
  let dir = '';
  const dealer = { id: 'dealer-por', email: 'dealer-por@example.test', role: 'dealer' } as SessionUser;
  const otherDealer = { id: 'dealer-other', email: 'other@example.test', role: 'dealer' } as SessionUser;
  const admin = { id: 'admin-por', email: 'admin-por@example.test', role: 'admin' } as SessionUser;
  const customerId = 'customer-por';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-quote-por-'));
    process.env.WING_LOCAL_DIR = dir;
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 照明（別途見積の商品）を選んだ Web の案件と、その概算（第 1 版。0 円の養生・80,000 円の電気設備工事を含む） */
  function seed() {
    const db = loadDb();
    const lighting = db.options.find((option) => option.price_on_request);
    if (!lighting) throw new Error('初期データに別途見積の商品がありません');
    const now = '2026-10-20T00:00:00.000Z';
    const cfg = {
      id: 'cfg-por',
      user_id: customerId,
      base_model_id: db.models[0].id,
      name: 'POR の案件',
      status: 'quote_requested',
      spec_code: null,
      finish_level: 'full',
      lock_version: 1,
      created_at: now,
      updated_at: now,
    } as unknown as Configuration;
    const item: ConfigurationItem = { id: 'ci-por', configuration_id: cfg.id, option_id: lighting.id, quantity: 1, variant_choice_ids: [] };
    const quote = {
      id: 'q-por-1',
      quote_no: 'Q-POR-1',
      quote_request_id: 'req-por',
      configuration_id: cfg.id,
      user_id: customerId,
      status: 'issued',
      issued_at: now,
      valid_until: now,
      customer_no: null,
      customer_name: 'お客様',
      customer_company: null,
      base_model_name: 'Wing',
      finish_level: 'full',
      base_price: 1_000_000,
      base_expense: 0,
      option_subtotal: 0,
      option_expense: 0,
      installation_subtotal: 80_000,
      adjustment: 0,
      subtotal: 1_080_000,
      tax_rate: 0.1,
      tax: 108_000,
      total: 1_188_000,
      dealer_id: dealer.id,
      dealer_note: null,
      revision: 1,
      parent_quote_id: null,
      preview_image_url: null,
      notes: null,
      created_at: now,
      updated_at: now,
    } as Quote;
    const lines: QuoteItem[] = [
      { id: 'qi-base', quote_id: quote.id, kind: 'base', name: '本体一式', description: null, unit: '式', remark: null, unit_price: 1_000_000, quantity: 1, amount: 1_000_000, image_url: null, sort_order: 0 },
      { id: 'qi-light', quote_id: quote.id, kind: 'option', name: lighting.name, description: '設置場所確認後に別途お見積り', unit: '式', remark: null, unit_price: 0, quantity: 1, amount: 0, image_url: null, sort_order: 1000 },
      { id: 'qi-cure', quote_id: quote.id, kind: 'installation', name: '養生', description: null, unit: '式', remark: null, unit_price: 0, quantity: 1, amount: 0, image_url: null, sort_order: 2000 },
      { id: 'qi-elec', quote_id: quote.id, kind: 'installation', name: '電気設備工事', description: null, unit: '式', remark: null, unit_price: 80_000, quantity: 1, amount: 80_000, image_url: null, sort_order: 2001 },
    ];
    const request = {
      id: 'req-por',
      configuration_id: cfg.id,
      user_id: customerId,
      quote_id: quote.id,
      status: 'sent',
      message: null,
      contact: { full_name: 'お客様', company_name: null, email: 'c@example.test', phone: '', address: '', site_address: null },
      created_at: now,
      updated_at: now,
    } as QuoteRequest;
    db.configurations.push(cfg);
    db.configurationItems.push(item);
    db.quotes.push(quote);
    db.quoteItems.push(...lines);
    db.quoteRequests.push(request);
    saveDb(db);
    return { lighting, quote, keys: [`product:${lighting.id}`] };
  }

  type Line = { kind: 'option' | 'installation'; name: string; description: string | null; unit: string; remark: string | null; unit_price: number; quantity: number };
  /** 改訂の明細（照明・養生・電気設備工事）。照明の扱いは引数で変える（備考は画面の選択からサーバーが付けた後の値） */
  const items = (lightingName: string, lighting: { unit_price: number; remark: string | null }, extra: Partial<Record<'cure' | 'elec', Partial<Line>>> = {}): Line[] => [
    { kind: 'option', name: lightingName, description: '設置場所確認後に別途お見積り', unit: '式', remark: lighting.remark, unit_price: lighting.unit_price, quantity: 1 },
    { kind: 'installation', name: '養生', description: null, unit: '式', remark: null, unit_price: 0, quantity: 1, ...extra.cure },
    { kind: 'installation', name: '電気設備工事', description: null, unit: '式', remark: null, unit_price: 80_000, quantity: 1, ...extra.elec },
  ];
  const zeroConfirmed = { unit_price: 0, remark: '［0円確定］：電気設備工事に含む' };

  it('一覧は本部と担当の代理店だけが取れ、確認の前は未確認', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    await expect(store.getQuotePorSelections(quote.id, otherDealer)).rejects.toThrow('別途見積を確認できません');
    const state = await store.getQuotePorSelections(quote.id, dealer);
    expect(state).toEqual({ selections: [{ key: `product:${lighting.id}`, option_id: lighting.id, name: lighting.name, detail: null }], confirmed: false, available: true });
    expect((await store.getQuotePorSelections(quote.id, admin)).selections).toHaveLength(1);
  });

  it('別途見積の行は前の版から変えていなくても、0 円のままなら発行しない。止めた発行では何も変わらない', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: null }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow(`金額が未確定の明細が 1 行残っています（${lighting.name}）`);
    const db = loadDb();
    expect(db.quotes.filter((row) => row.quote_request_id === 'req-por')).toHaveLength(1);
    expect(db.quotes.find((row) => row.id === quote.id)?.status).toBe('issued');
    // 確認の記録は発行とは別に残る（DB と同じ）
    expect(db.quotePorConfirmations ?? []).toHaveLength(1);
  });

  it('自由記述の備考（例：電気設備工事に含む）では解消しない。「0円確定（理由）」なら発行できる', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: '電気設備工事に含む' }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow('金額が未確定の明細が 1 行残っています');
    const next = await store.createDealerRevision(quote.id, { items: items(lighting.name, zeroConfirmed), dealer_note: null, por_confirmation_keys: keys }, dealer);
    expect(next.revision).toBe(2);
    expect(loadDb().quoteItems.find((row) => row.quote_id === next.id && row.name === lighting.name)?.remark).toBe('［0円確定］：電気設備工事に含む');
  });

  it('「対象外」の明細があっても、確定した範囲の正式見積は発行できる', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    const next = await store.createDealerRevision(
      quote.id,
      { items: items(lighting.name, { unit_price: 0, remark: '［今回の契約対象外］お客様手配' }), dealer_note: null, por_confirmation_keys: keys },
      dealer
    );
    expect(next.revision).toBe(2);
  });

  it('新しく足した 0 円の行・0 円に変えた明細は未確定。前の版と同じ 0 円の明細（養生）はそのまま', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    const base = items(lighting.name, zeroConfirmed);
    await expect(
      store.createDealerRevision(
        quote.id,
        { items: [...base, { kind: 'installation', name: '追加の運搬', description: null, unit: '式', remark: null, unit_price: 0, quantity: 1 }], dealer_note: null, por_confirmation_keys: keys },
        dealer
      )
    ).rejects.toThrow('金額が未確定の明細が 1 行残っています（追加の運搬）');
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, zeroConfirmed, { elec: { unit_price: 0 } }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow('金額が未確定の明細が 1 行残っています（電気設備工事）');
    // 前の版に 1 行の養生と同じものをもう 1 行足すと、足した 1 行は未確定（前の版の行の数まで）
    await expect(
      store.createDealerRevision(
        quote.id,
        { items: [...base, { kind: 'installation', name: '養生', description: null, unit: '式', remark: null, unit_price: 0, quantity: 1 }], dealer_note: null, por_confirmation_keys: keys },
        dealer
      )
    ).rejects.toThrow('金額が未確定の明細が 1 行残っています（養生）');
    // 養生の説明を変えると、前の版と同じ明細ではなくなる
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, zeroConfirmed, { cure: { description: '範囲を変更' } }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow('金額が未確定の明細が 1 行残っています（養生）');
    const next = await store.createDealerRevision(quote.id, { items: base, dealer_note: null, por_confirmation_keys: keys }, dealer);
    expect(next.revision).toBe(2);
  });

  it('状態の印のある行は 0 円・0円確定は理由が必要（表の保存境界。DB のトリガーと同じ）', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 5000, remark: '［今回の契約対象外］' }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow('0 円にしてください');
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: '［0円確定］：' }), dealer_note: null, por_confirmation_keys: keys }, dealer)
    ).rejects.toThrow('理由を入力してください');
    expect(loadDb().quotes.filter((row) => row.quote_request_id === 'req-por')).toHaveLength(1);
  });

  it('明細を解消しても、担当者の確認がなければ発行しない。一覧が違えば確認を記録しない', async () => {
    const { lighting, quote } = seed();
    const store = new LocalStore();
    await expect(store.createDealerRevision(quote.id, { items: items(lighting.name, zeroConfirmed), dealer_note: null }, dealer)).rejects.toThrow(
      'お客様が選んだ別途見積の商品（1 件'
    );
    await expect(
      store.createDealerRevision(quote.id, { items: items(lighting.name, zeroConfirmed), dealer_note: null, por_confirmation_keys: ['product:other'] }, dealer)
    ).rejects.toThrow('画面を開いた後に変わりました');
    expect(loadDb().quotePorConfirmations ?? []).toHaveLength(0);
  });

  it('本部の確認は担当代理店の確認の代わりにならない。担当代理店が確認すれば発行でき、確認は版ごと', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    const resolved = items(lighting.name, zeroConfirmed);
    // 本部が確認だけを記録しても（発行は未確定の 0 円で止まる）、担当代理店の発行には使えない
    await expect(store.createDealerRevision(quote.id, { items: items(lighting.name, { unit_price: 0, remark: null }), dealer_note: null, por_confirmation_keys: keys }, admin)).rejects.toThrow('残っています');
    await expect(store.createDealerRevision(quote.id, { items: resolved, dealer_note: null }, dealer)).rejects.toThrow('お客様が選んだ別途見積の商品');

    const next = await store.createDealerRevision(quote.id, { items: resolved, dealer_note: null, por_confirmation_keys: keys }, dealer);
    expect(next.revision).toBe(2);
    const db = loadDb();
    expect(db.quotes.find((row) => row.id === quote.id)?.status).toBe('superseded');
    expect(db.quoteRequests.find((row) => row.id === 'req-por')?.quote_id).toBe(next.id);
    expect((db.quotePorConfirmations ?? []).map((row) => row.confirmed_by).sort()).toEqual([admin.id, dealer.id].sort());
    expect((await store.getQuotePorSelections(next.id, dealer)).confirmed).toBe(false);
  });

  it('同じ担当者が同じ一覧を何度確認しても、記録は 1 つ', async () => {
    const { lighting, quote, keys } = seed();
    const store = new LocalStore();
    const unresolved = items(lighting.name, { unit_price: 0, remark: null });
    await expect(store.createDealerRevision(quote.id, { items: unresolved, dealer_note: null, por_confirmation_keys: keys }, dealer)).rejects.toThrow();
    await expect(store.createDealerRevision(quote.id, { items: unresolved, dealer_note: null, por_confirmation_keys: keys }, dealer)).rejects.toThrow();
    expect(loadDb().quotePorConfirmations ?? []).toHaveLength(1);
    expect((await store.getQuotePorSelections(quote.id, dealer)).confirmed).toBe(true);
  });
});
