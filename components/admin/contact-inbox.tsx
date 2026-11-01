'use client';

import { useMemo, useState } from 'react';
import { ContactClassificationForm, ContactStatusForm } from '@/components/admin/forms';
import { formatDate } from '@/lib/utils';
import type { ContactMessage } from '@/lib/domain/types';

type StatusFilter = 'all' | 'new' | 'in_progress' | 'handled';
type ClassificationFilter = 'normal' | 'sales' | 'spam' | 'all';
type ContactInboxMessage = Omit<ContactMessage, 'attachment_path'> & { has_attachment: boolean };

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

/** 一覧は短く表示し、本文・連絡先・添付ファイルは行の詳細で確認する。 */
export function ContactInbox({ messages, classificationReady = true }: { messages: ContactInboxMessage[]; classificationReady?: boolean }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>('normal');
  const [topic, setTopic] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      {!classificationReady && (
        <p role="status" className="rounded-md border border-line bg-sand p-3 text-xs text-ink-soft">
          分類・対応中の機能は本番DBの更新後に利用できます。従来の対応済み切替は利用可能です。
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_14rem]">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          検索
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名前・メール・内容など"
            aria-label="問い合わせを検索"
            className="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-offset-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          対応状況
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="all">すべて</option>
            <option value="new">未対応</option>
            {classificationReady && <option value="in_progress">対応中</option>}
            <option value="handled">対応済み</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          お問い合わせの種類
          <select
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">すべて</option>
            {topics.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-ink-soft">
          分類
          <select value={classificationFilter} onChange={(event) => setClassificationFilter(event.target.value as ClassificationFilter)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink">
            <option value="normal">通常（営業・迷惑を除外）</option>
            <option value="sales" disabled={!classificationReady}>営業</option>
            <option value="spam" disabled={!classificationReady}>迷惑</option>
            <option value="all">すべて</option>
          </select>
        </label>
        <p className="text-xs text-muted" role="status">表示 {filtered.length} 件／全 {messages.length} 件</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[64rem] table-fixed text-left text-xs">
          <thead className="bg-sand/60 text-ink-soft">
            <tr>
              <th scope="col" className="w-36 px-3 py-2 font-semibold">受付日時</th>
              <th scope="col" className="w-44 px-3 py-2 font-semibold">お名前</th>
              <th scope="col" className="w-44 px-3 py-2 font-semibold">種類</th>
              <th scope="col" className="px-3 py-2 font-semibold">内容</th>
              <th scope="col" className="w-24 px-3 py-2 font-semibold">添付</th>
              <th scope="col" className="w-40 px-3 py-2 font-semibold">状態・操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((message) => {
              const expanded = expandedId === message.id;
              const attachmentUrl = `/api/admin/contacts/${encodeURIComponent(message.id)}/attachment`;
              const hasAttachment = message.has_attachment;
              return (
                <FragmentRow
                  key={message.id}
                  message={message}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : message.id)}
                  attachmentUrl={attachmentUrl}
                  hasAttachment={hasAttachment}
                  classificationReady={classificationReady}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {messages.length ? '条件に一致するお問い合わせはありません' : 'お問い合わせはまだありません'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        添付画像・PDFは本部管理者だけが閲覧・保存できます。非公開Storageの公開設定は変更していません。
      </p>
    </div>
  );
}

function FragmentRow({
  message,
  expanded,
  onToggle,
  attachmentUrl,
  hasAttachment,
  classificationReady,
}: {
  message: ContactInboxMessage;
  expanded: boolean;
  onToggle: () => void;
  attachmentUrl: string;
  hasAttachment: boolean;
  classificationReady: boolean;
}) {
  return (
    <>
      <tr data-testid="contact-row" className="align-top">
        <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(message.created_at, true)}</td>
        <td className="max-w-0 px-3 py-3">
          <p className="truncate font-semibold text-ink" title={message.full_name}>{message.full_name}</p>
        </td>
        <td className="max-w-0 px-3 py-3">
          <p className="truncate text-ink-soft" title={message.topic}>{message.topic}</p>
        </td>
        <td className="max-w-0 px-3 py-3">
          <p className="truncate text-ink-soft" title={message.message}>{message.message}</p>
        </td>
        <td className="px-3 py-3">
          {hasAttachment ? <span className="whitespace-nowrap text-ink">添付あり</span> : <span className="text-muted">—</span>}
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-col items-start gap-1.5">
            <span className={message.status === 'new' ? 'font-semibold text-danger' : 'text-forest'}>
              {message.status === 'new' ? '未対応' : message.status === 'in_progress' ? '対応中' : '対応済み'}
            </span>
            {(message.classification ?? 'normal') !== 'normal' && (
              <span className="text-xs text-muted">{message.classification === 'sales' ? '営業' : '迷惑'}</span>
            )}
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`contact-detail-${message.id}`}
              className="font-semibold text-ink underline underline-offset-4"
              onClick={onToggle}
            >
              {expanded ? '閉じる' : '詳細を見る'}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr id={`contact-detail-${message.id}`} className="bg-sand/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-semibold text-ink">お問い合わせ内容</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{message.message}</p>
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-ink">連絡先</p>
                  <a href={`mailto:${message.email}`} className="break-all text-sm underline underline-offset-4">
                    {message.email}
                  </a>
                  {message.phone && (
                    <p className="mt-1 text-sm">
                      <a href={`tel:${message.phone.replace(/[^+\d]/g, '')}`} className="underline underline-offset-4">
                        {message.phone}
                      </a>
                    </p>
                  )}
                </div>
                {hasAttachment && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-ink">添付ファイル</p>
                    <p className="break-all text-xs text-ink-soft">{message.attachment_name}</p>
                    <div className="flex flex-wrap gap-3">
                      <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">
                        開く
                      </a>
                      <a href={`${attachmentUrl}?download=1`} className="text-sm font-semibold underline underline-offset-4">
                        保存
                      </a>
                    </div>
                  </div>
                )}
                <ContactStatusForm id={message.id} status={message.status} classificationReady={classificationReady} />
                {classificationReady && <ContactClassificationForm id={message.id} classification={message.classification ?? 'normal'} />}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
