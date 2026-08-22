import Image from 'next/image';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui';

export function AuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <Container className="grid min-h-[70vh] items-stretch gap-0 py-10 lg:grid-cols-2 lg:py-16">
      <div className="relative hidden overflow-hidden rounded-3xl lg:block">
        <Image src="/images/interior/bedroom-seaview.webp" alt="海を望むWingの室内" fill sizes="50vw" className="object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent p-10 text-white">
          <p className="font-serif text-2xl">保存して、いつでも続きから。</p>
          <p className="mt-2 text-sm text-white/80">作成した仕様はマイページに保存され、見積書PDFもいつでも確認できます。</p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-md lg:px-12 lg:py-6">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 text-ink-soft">{lead}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </Container>
  );
}
