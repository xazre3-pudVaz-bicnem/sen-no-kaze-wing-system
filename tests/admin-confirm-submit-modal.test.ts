import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const confirmSubmit = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/confirm-submit.tsx'),
  'utf8'
);
const optionPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);

describe('管理画面の確認モーダル', () => {
  it('ブラウザ標準confirmではなく画面中央のアプリ内モーダルを使う', () => {
    expect(confirmSubmit).not.toContain('window.confirm');
    expect(confirmSubmit).toContain('createPortal');
    expect(confirmSubmit).toContain('fixed inset-0 z-[100] flex items-center justify-center');
    expect(confirmSubmit).toContain('role="dialog"');
    expect(confirmSubmit).toContain('aria-modal="true"');
    expect(confirmSubmit).toContain('キャンセル');
  });

  it('登録前の必須入力を先に検証し、確認後は元のformを正式submitする', () => {
    expect(confirmSubmit).toContain('form.reportValidity()');
    expect(confirmSubmit).toContain('form.requestSubmit(submitter)');
    expect(confirmSubmit).toContain("event.key !== 'Escape'");
    expect(confirmSubmit).toContain("document.body.style.overflow = 'hidden'");
  });

  it('商品登録STEP2の登録操作が共通確認モーダルを通る', () => {
    expect(optionPage).toContain('<ConfirmSubmit');
    expect(optionPage).toContain('この内容で登録');
    expect(optionPage).toContain('この内容で登録しますか？');
    expect(optionPage).toContain('商品価格0円で登録しますか？');
  });
});
