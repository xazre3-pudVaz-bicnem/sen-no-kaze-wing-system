'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Link2, LogIn, Mail, MessageCircle, X } from 'lucide-react';
import { createGuestPlanAction } from '@/lib/actions/guest-plans';
import { GUEST_PLAN_DAYS, type GuestPlanInput } from '@/lib/domain/case-flow';
import { Alert, Button, Spinner } from '@/components/ui';

interface Props {
  modelSlug: string;
  baseModelId: string;
  /** 一時保存する仕様の選択（価格は保存しない） */
  plan: GuestPlanInput;
  /** 会員登録・ログインしてマイページに保存する（選択内容はこの端末に残したままログインへ） */
  onLogin: () => void;
  onClose: () => void;
}

const formatExpiry = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));

/**
 * 未ログインの「見積を保存する」（フローチャート フェーズ2「未ログイン＝一時保存」）。
 * マイページに保存する（会員登録・ログイン）か、ログインせずに一時保存して URL を受け取るかを選ぶ。
 * 一時保存の URL は 30 日間、ほかの端末からも開ける（後で検討する → 保存プランから後日再開）。
 */
export function GuestSaveDialog({ modelSlug, baseModelId, plan, onLogin, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await createGuestPlanAction({ base_model_id: baseModelId, plan });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ url: new URL(`/simulator/${modelSlug}?plan=${result.token}`, window.location.origin).toString(), expiresAt: result.expires_at });
    });
  };

  const copy = async () => {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const shareText = saved ? `千の風の見積プラン（一時保存）\n${saved.url}` : '';

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="guest-save-title"
      data-testid="guest-save-dialog"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="guest-save-title" className="text-xl">
            {saved ? '一時保存しました' : 'このプランを保存'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {!saved ? (
          <>
            <p className="mt-2 text-sm text-ink-soft">保存の方法を選んでください。</p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={onLogin}
                className="flex w-full items-start gap-3 rounded-xl border border-ink bg-ink px-4 py-3 text-left text-white hover:opacity-90"
                data-testid="guest-save-login"
              >
                <LogIn className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="block font-semibold">会員登録・ログインして保存</span>
                  <span className="mt-0.5 block text-xs text-white/80">マイページに保存して、いつでも再編集・見積依頼ができます。</span>
                </span>
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="flex w-full items-start gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left hover:bg-sand disabled:opacity-60"
                data-testid="guest-save-temporary"
              >
                {pending ? <Spinner /> : <Link2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
                <span>
                  <span className="block font-semibold">ログインせずに一時保存する</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    保存用の URL を発行します。{GUEST_PLAN_DAYS}日間、ほかのスマホやパソコンからも続きを開けます。
                  </span>
                </span>
              </button>
            </div>
            {error && (
              <Alert tone="danger" className="mt-4">
                {error}
              </Alert>
            )}
          </>
        ) : (
          <div className="mt-3 space-y-4" data-testid="guest-plan-saved">
            <p className="text-sm text-ink-soft">
              この URL を開くと、続きから再開できます（<strong className="text-ink">{formatExpiry(saved.expiresAt)}まで有効</strong>）。
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={saved.url}
                onFocus={(e) => e.currentTarget.select()}
                className="input h-10 min-w-0 flex-1 text-xs"
                aria-label="一時保存の URL"
                data-testid="guest-plan-url"
              />
              <Button type="button" variant="secondary" size="sm" onClick={copy}>
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? 'コピーしました' : 'コピー'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`mailto:?subject=${encodeURIComponent('千の風の見積プラン（一時保存）')}&body=${encodeURIComponent(shareText)}`}
                className="btn-ghost btn-sm"
              >
                <Mail className="size-4" aria-hidden="true" />
                メールで自分に送る
              </a>
              <a href={`https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
                <MessageCircle className="size-4" aria-hidden="true" />
                LINEで送る
              </a>
            </div>
            <p className="text-[0.7rem] leading-relaxed text-muted">
              URL を知っている人は、このプランを開けます（お名前などの個人情報は含みません）。金額は開いたときの価格で計算し直します。
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>
                閉じる
              </Button>
              <Button type="button" onClick={onLogin}>
                会員登録してマイページに保存
              </Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
