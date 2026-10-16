import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

const confirmAction = read('components/admin/confirm-action-button.tsx');
const baseMaster = read('components/admin/base-master-revision-form.tsx');
const standardEstimate = read('components/admin/standard-estimate-editor.tsx');
const standardQuote = read('components/admin/standard-quote-editor.tsx');
const quoteDraft = read('components/admin/quote-draft-editor.tsx');
const contracts = read('components/admin/electronic-contract-forms.tsx');

describe('重要操作の確認UI', () => {
  it('非submit操作も画面中央のアプリ内モーダルで確認できる', () => {
    expect(confirmAction).toContain('createPortal');
    expect(confirmAction).toContain('fixed inset-0 z-[100] flex items-center justify-center');
    expect(confirmAction).toContain('role="dialog"');
    expect(confirmAction).toContain('aria-modal="true"');
    expect(confirmAction).toContain("event.key !== 'Escape'");
    expect(confirmAction).not.toContain('window.confirm');
  });

  it('本体マスターの公開・破棄・保存時点へ戻す操作を中央確認に統一する', () => {
    expect(baseMaster).toContain('ConfirmActionButton');
    expect(baseMaster).toContain('ConfirmSubmit');
    expect(baseMaster).toContain('本体マスターを公開しますか？');
    expect(baseMaster).toContain('下書きを破棄しますか？');
    expect(baseMaster).not.toContain('window.confirm');
  });

  it('標準見積の公開と標準見積からの正式見積発行を中央確認にする', () => {
    expect(standardEstimate).toContain('ConfirmActionButton');
    expect(standardEstimate).toContain('標準見積を公開しますか？');
    expect(standardQuote).toContain('ConfirmActionButton');
    expect(standardQuote).toContain('正式な見積書を発行しますか？');
    expect(standardQuote).not.toContain('window.confirm');
  });

  it('案件見積の正式発行は中央確認にし、未保存の画面遷移確認だけブラウザ確認を残す', () => {
    expect(quoteDraft).toContain('ConfirmSubmit');
    expect(quoteDraft).toContain('正式な${formalRevisionLabel}を発行しますか？');
    expect(quoteDraft).not.toContain('window.alert');
    expect((quoteDraft.match(/window\.confirm/g) ?? []).length).toBe(1);
    expect(quoteDraft).toContain('保存せずに別の見積書へ移動しますか？');
  });

  it('電子契約の送信・取消を送信前に中央確認する', () => {
    expect(contracts).toContain('契約書を送信しますか？');
    expect(contracts).toContain('この契約を取り消しますか？');
    expect((contracts.match(/<ConfirmSubmit/g) ?? []).length).toBe(2);
  });
});
