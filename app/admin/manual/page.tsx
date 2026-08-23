import Link from 'next/link';
import { ArrowRight, Check, CircleAlert, Info, Ban } from 'lucide-react';
import { requireStaff } from '@/lib/auth/session';
import { manualFor, type ManualBlock } from '@/lib/manual/content';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { cn } from '@/lib/utils';

const TONE = {
  info: { icon: Info, box: 'border-forest/40 bg-forest/5', label: 'text-forest' },
  caution: { icon: CircleAlert, box: 'border-warn/40 bg-warn/5', label: 'text-warn' },
  stop: { icon: Ban, box: 'border-danger/40 bg-danger/5', label: 'text-danger' },
} as const;

function Block({ block }: { block: ManualBlock }) {
  switch (block.t) {
    case 'h3':
      return <h3 className="mt-2 font-semibold">{block.text}</h3>;

    case 'p':
      return <p className="max-w-3xl text-sm leading-[1.9] text-ink-soft">{block.text}</p>;

    case 'list':
      return (
        <ul className="max-w-3xl space-y-1.5">
          {block.items.map((t) => (
            <li key={t} className="flex gap-2 text-sm leading-[1.9]">
              <Check className="mt-1.5 size-3.5 shrink-0 text-forest" aria-hidden="true" />
              <span className="text-ink-soft">{t}</span>
            </li>
          ))}
        </ul>
      );

    case 'steps':
      return (
        <ol className="max-w-3xl space-y-3">
          {block.items.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-forest tabular-nums">
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{s.title}</span>
                {s.note && <span className="mt-0.5 block text-sm leading-[1.9] text-muted">{s.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      );

    case 'table':
      return (
        <Table minWidth="30rem">
          <thead className="bg-sand/60">
            <tr>
              {block.head.map((h) => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {block.rows.map((r) => (
              <tr key={r.join('|')}>
                {r.map((cell, i) => (
                  <Td key={i} className={i === 0 ? 'font-semibold' : undefined}>
                    {cell}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      );

    case 'flow':
      return (
        <div className="card max-w-3xl divide-y divide-line overflow-hidden">
          {block.rows.map((r) => (
            <div
              key={r.who + r.what}
              className={cn('grid grid-cols-[6rem_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm', r.mine && 'bg-sand/50')}
            >
              <span className={cn('text-xs font-semibold', r.mine ? 'text-forest' : 'text-muted')}>{r.who}</span>
              <span className="text-ink-soft">{r.what}</span>
            </div>
          ))}
        </div>
      );

    case 'note': {
      const tone = TONE[block.tone];
      const Icon = tone.icon;
      return (
        <div className={cn('flex max-w-3xl gap-3 rounded-lg border px-4 py-3', tone.box)}>
          <Icon className={cn('mt-0.5 size-4 shrink-0', tone.label)} aria-hidden="true" />
          <div>
            {block.title && <p className={cn('text-sm font-semibold', tone.label)}>{block.title}</p>}
            <p className="text-sm leading-[1.9] text-ink-soft">{block.text}</p>
          </div>
        </div>
      );
    }

    case 'link':
      return (
        <p>
          <Link href={block.href} className="btn-secondary btn-sm">
            {block.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </p>
      );
  }
}

/** 権限に応じた操作マニュアル。左メニューから開く */
export default async function AdminManualPage() {
  const actor = await requireStaff();
  const { title, lead, sections } = manualFor(actor.role);

  return (
    <AdminPage title={title} lead={lead}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start">
        <div className="min-w-0 space-y-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-6 space-y-3">
              <h2 className="border-b border-ink pb-2 font-serif text-xl">{s.title}</h2>
              {s.lead && <p className="max-w-3xl text-sm leading-[1.9] text-ink-soft">{s.lead}</p>}
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
        </div>

        <nav aria-label="マニュアルの目次" className="min-w-0 lg:sticky lg:top-6">
          <p className="mb-2 text-xs font-semibold text-muted">目次</p>
          <ol className="space-y-0.5 border-l border-line">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block border-l-2 border-transparent py-1 pl-3 text-sm text-ink-soft hover:border-forest hover:text-ink">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </AdminPage>
  );
}
