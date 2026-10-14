import type { ReactNode } from 'react';
import { requireStaff } from '@/lib/auth/session';
import { getOptionHqStandardCostAccess } from '@/lib/data/option-hq-standard-cost';
import { OptionHqStandardCostCard } from '@/components/admin/option-hq-standard-cost-card';

export default async function OptionDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const access = await getOptionHqStandardCostAccess(id);

  return (
    <>
      {children}
      {access.available && access.canView && (
        <div className="mx-auto mt-6 max-w-6xl">
          <OptionHqStandardCostCard
            optionId={id}
            canManage={access.canManage}
            cost={access.cost}
          />
        </div>
      )}
    </>
  );
}
