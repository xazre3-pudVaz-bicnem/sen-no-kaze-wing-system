import type { ReactNode } from 'react';
import { requireStaff } from '@/lib/auth/session';

export default async function OptionDetailLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStaff();
  return children;
}
