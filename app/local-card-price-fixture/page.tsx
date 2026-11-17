import { notFound } from 'next/navigation';
import { SimulatorCardPriceFixture } from '@/components/simulator/__test__/simulator-card-price-fixture';

/**
 * Isolated Playwright-only fixture. Unavailable unless the disposable local
 * mode is explicitly enabled; never reads external DB/revision or user data.
 */
export default function LocalCardPriceFixturePage() {
  if (process.env.WING_LOCAL_MODE !== '1' || process.env.NODE_ENV !== 'development') notFound();
  return <SimulatorCardPriceFixture />;
}
