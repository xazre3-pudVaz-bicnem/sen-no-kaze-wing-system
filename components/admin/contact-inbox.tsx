'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Paperclip, Search } from 'lucide-react';
import { ContactClassificationForm, ContactStatusForm } from '@/components/admin/forms';
import { formatDate } from '@/lib/utils';
import type { ContactMessage } from '@/lib/domain/types';

type StatusFilter = 'all' | 'new' | 'in_progress' | 'handled';
type ClassificationFilter = 'normal' | 'sales' | 'spam' | 'all';
type ContactInboxMessage = Omit<ContactMessage, 'attachment_path'> & { has_attachment: boolean };

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'new', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'handled', label: '対応済み' },
];

function statusLabel(status: ContactInboxMessage['status']) {
  return status === 'new' ? '未対応' : status === 'in_progress' ? '対応中' : '対応済み';
}

function matchesContact(message: ContactInboxMessage, query: string, status: StatusFilter, topic: string) {
  if (status !== 'all' && message.status !== status) return false;
  if (topic && message.topic !== topic) return false;
  const normalized = query.trim().toLocaleLowerCase('ja-JP');
  if (!normalized) return true;
  return [
    message.full_name,
    message.email,
    message.phone ?? '',
    message.topic,
    message.message,
  ]
    .join(' ')
    .toLocaleLowerCase('ja-JP')
    .includes(normalized);
}

/** 受信箱型の一覧＋詳細。既存の保存・権限・添付取得・分類操作を変更しない。 */
export function ContactInbox({ messages, classificationReady = true }: { messages: ContactInboxMessage[]; classificationReady?: boolean }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>('normal');
  const [topic, setTopic] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const topics = useMemo(
    () => [...new Set(messages.map((message) => message.topic))].sort((a, b) => a.localeCompare(b, 'ja')),
    [messages],
  );
  const filtered = useMemo(
    () => messages.filter((message) =>
      (classificationFilter === 'all' || (message.classification ?? 'normal') === classificationFilter) &&
      matchesContact(message, query, status, topic)),
    [messages, query, status, topic, classificationFilter],
  );
  const selected = filtered.find((message) => message.id === selectedId) ?? filtered[0] ?? null;
  const classificationMatches = (message: ContactInboxMessage) =>
    classificationFilter === 'all' || (message.classification ?? 'normal') === classificationFilter;
  const countStatus = (value: StatusFilter) =>
    messages.filter((message) => classificationMatches(message) && (value === 'all' || message.status === value)).length;

  return (
    <div className="space-y-3">
      {!classificationReady && (
        <p role="status" className="rounded-md border border-line bg-sand p-3 text-xs text-ink-soft">
          分類・対応中の機能は本番DBの更新後に利用できます。従来の対応済み切替は利用可能です。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="対応状況で絞り込む">
        {statusOptions.filter((option) => classificationReady || option.value !== 'in_progress').map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={status === option.value}
            onClick={() => { setStatus(option.value); setMobileDetailOpen(false); }}
            className={
              'rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ' +
              (status === option.value
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-white text-ink-soft hover:bg-sand')
            }
          >
            {option.label} <span className="tabular-nums">{countStatus(option.value)}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)_minmax(10rem,13rem)]">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
          検索
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setMobileDetailOpen(false); }}
              placeholder="名前・メール・内容など"
              aria-label="問い合わせを検索"
              className="w-full min-w-0 rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink outline-offset-2"
            />
          </span>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
          お問い合わせの種類
          <select
            value={topic}
            onChange={(event) => { setTopic(event.target.value); setMobileDetailOpen(false); }}
            className="w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">すべて</option>
            {topics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
          分類
          <select
            value={classificationFilter}
            onChange={(event) => { setClassificationFilter(event.target.value as ClassificationFilter); setMobileDetailOpen(false); }}
            className="w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="normal">通常（営業・迷惑を除外）</option>
            <option value="sales" disabled={!classificationReady}>営業</option>
            <option value="spam" disabled={!classificationReady}>迷惑</option>
            <option value="all">すべて</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-muted" role="status">表示 {filtered.length} 件／全 {messages.length} 件</p>

      <div className="grid min-w-0 overflow-hidden rounded-xl border border-line bg-white lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]" data-testid="contact-inbox-split">
        <section aria-label="問い合わせ一覧" className={(mobileDetailOpen ? 'hidden lg:block ' : '') + 'min-w-0 lg:border-r lg:border-line'}>
          <div className="border-b border-line bg-sand/40 px-3 py-2 text-xs font-semibold text-ink-soft">
            問い合わせ一覧
          </div>
          <ul className="max-h-[66vh] overflow-y-auto divide-y divide-line lg:max-h-[65vh]">
            {filtered.map((message) => (
              <li key={message.id} data-testid="contact-row">
                <button
                  type="button"
                  aria-pressed={selected?.id === message.id}
                  onClick={() => { setSelectedId(message.id); setMobileDetailOpen(true); }}
                  className={
                    'w-full min-w-0 space-y-1 px-3 py-3 text-left outline-offset-[-2px] hover:bg-sand/70 ' +
                    (selected?.id === message.id ? 'bg-sand/70 lg:border-l-4 lg:border-forest lg:pl-2' : '')
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{message.full_name}</span>
                    <span className="shrink-0 text-[0.68rem] tabular-nums text-muted">{formatDate(message.created_at, true)}</span>
                  </span>
                  <span className="block truncate text-xs font-medium text-ink-soft" title={message.topic}>{message.topic}</span>
                  <span className="block truncate text-xs text-muted" title={message.message}>{message.message}</span>
                  <span className="flex items-center gap-2 text-[0.68rem]">
                    <span className={message.status === 'new' ? 'font-semibold text-danger' : 'text-forest'}>{statusLabel(message.status)}</span>
                    {message.has_attachment && <span className="inline-flex items-center gap-1 text-ink-soft"><Paperclip className="size-3" aria-hidden="true" />添付あり</span>}
                    {(message.classification ?? 'normal') !== 'normal' && (
                      <span className="text-muted">{message.classification === 'sales' ? '営業' : '迷惑'}</span>
                    )}
                  </span>
                  <span className="sr-only">詳細を見る</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                {messages.length ? '条件に一致するお問い合わせはありません' : 'お問い合わせはまだありません'}
              </li>
            )}
          </ul>
        </section>

        <section
          aria-label="問い合わせ詳細"
          className={(mobileDetailOpen ? '' : 'hidden lg:block ') + 'min-w-0'}
          data-testid="contact-detail-pane"
        >
          {selected ? (
            <div className="max-h-[75vh] min-w-0 overflow-y-auto lg:max-h-[65vh]">
              <div className="border-b border-line px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                  className="mb-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-sand lg:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" /> 一覧に戻る
                </button>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-ink">{selected.full_name}</h2>
                    <p className="mt-1 text-xs text-ink-soft">{selected.topic}</p>
                    <p className="mt-1 text-xs tabular-nums text-muted">受付 {formatDate(selected.created_at, true)}</p>
                  </div>
                  <span className={'rounded-full px-2.5 py-1 text-xs font-semibold ' + (
                    selected.status === 'new' ? 'bg-red-50 text-danger' : 'bg-sand text-forest'
                  )}>{statusLabel(selected.status)}</span>
                </div>
              </div>

              <div className="space-y-5 p-4">
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-ink-soft">連絡先</h3>
                  <a className="block break-all text-sm font-medium text-ink underline underline-offset-4" href={'mailto:' + selected.email}>{selected.email}</a>
                  {selected.phone && (
                    <a className="block text-sm text-ink underline underline-offset-4" href={'tel:' + selected.phone.replace(/[^+\d]/g, '')}>{selected.phone}</a>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-ink-soft">お問い合わせ内容</h3>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-sand/40 p-3 text-sm leading-7 text-ink">{selected.message}</p>
                </div>

                {selected.has_attachment && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-ink-soft">添付ファイル</h3>
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
                      <Paperclip className="size-4 shrink-0 text-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-all text-sm">{selected.attachment_name}</span>
                      <a
                        href={'/api/admin/contacts/' + encodeURIComponent(selected.id) + '/attachment'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:bg-sand"
                      >開く</a>
                      <a
                        href={'/api/admin/contacts/' + encodeURIComponent(selected.id) + '/attachment?download=1'}
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:bg-sand"
                      >保存</a>
                    </div>
                  </div>
                )}

                <div className="space-y-3 border-t border-line pt-4">
                  <h3 className="text-sm font-semibold text-ink">対応の管理</h3>
                  <ContactStatusForm id={selected.id} status={selected.status} classificationReady={classificationReady} />
                  {classificationReady && <ContactClassificationForm id={selected.id} classification={selected.classification ?? 'normal'} />}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted">問い合わせを選択してください。</div>
          )}
        </section>
      </div>
      <p className="text-xs text-muted">
        添付画像・PDFは本部管理者だけが閲覧・保存できます。非公開Storageの公開設定は変更していません。
      </p>
    </div>
  );
}
