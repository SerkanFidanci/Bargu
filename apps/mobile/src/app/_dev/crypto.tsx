import { DevRoute } from '@/features/dev/route';

/** The crypto benchmark (features/dev/screens): the screen exists only where a build loads it. */
export default function CryptoRoute() {
  return <DevRoute name="crypto" />;
}
