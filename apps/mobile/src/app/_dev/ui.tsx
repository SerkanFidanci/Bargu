import { DevRoute } from '@/features/dev/route';

/** The component gallery (features/dev/screens): the screen exists only where a build loads it. */
export default function UiRoute() {
  return <DevRoute name="ui" />;
}
