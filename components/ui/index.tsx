import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------- レイアウト ---------- */

export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('container-x', className)} {...props} />;
}

export function Section({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('py-16 sm:py-24', className)} {...props} />;
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  as: Tag = 'h2',
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'left' | 'center';
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      <Tag className={cn(Tag === 'h1' ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-4xl')}>{title}</Tag>
      {lead && <p className="lead mt-4">{lead}</p>}
    </div>
  );
}

/* ---------- ボタン ---------- */

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';
const variantClass: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost' };
const sizeClass: Record<Size, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' };

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={cn(variantClass[variant], sizeClass[size], className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cn(variantClass[variant], sizeClass[size], className)} {...props} />;
}

/* ---------- フォーム ---------- */

export function Field({
  label,
  htmlFor,
  required,
  hint,
  errors,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  errors?: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required ? (
          <span className="ml-1.5 text-xs font-semibold text-danger">必須</span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-muted">任意</span>
        )}
      </label>
      {children}
      {hint && !errors?.length && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {errors?.length ? (
        <p className="mt-1 text-sm text-danger" role="alert">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('input', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('input min-h-32 py-3', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn('input appearance-none pr-10', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, label, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-start gap-2 text-sm', className)}>
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-brown" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* ---------- 表示 ---------- */

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'navy' }) {
  const tones = {
    neutral: 'bg-sand text-ink-soft',
    success: 'bg-success/10 text-success',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
    navy: 'bg-navy text-white',
  };
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}
      {...props}
    />
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warn' | 'danger';
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-navy/20 bg-navy/5 text-navy',
    success: 'border-success/30 bg-success/5 text-success',
    warn: 'border-warn/30 bg-warn/5 text-warn',
    danger: 'border-danger/30 bg-danger/5 text-danger',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-xl border px-4 py-3 text-sm', tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && 'mt-1')}>{children}</div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; path?: string }[] }) {
  return (
    <nav aria-label="パンくずリスト" className="text-xs text-muted sm:text-sm">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.name}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.path && i < items.length - 1 ? (
              <Link href={it.path} className="hover:text-ink hover:underline">
                {it.name}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className="text-ink-soft">
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
