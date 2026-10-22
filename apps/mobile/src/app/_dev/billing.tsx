import { DevRoute } from '@/features/dev/route';

/** The test billing (features/dev/screens): the screen exists only where a build loads it. */
export default function BillingRoute() {
  return <DevRoute name="billing" />;
}
