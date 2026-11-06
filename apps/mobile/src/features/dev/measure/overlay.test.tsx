import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { devResources } from '@/i18n/dev-resources';

jest.mock('../../circles/queries', () => ({ useCircles: () => ({ data: [] }) }));
jest.mock('@/platform/native-crypto', () => ({ nativeCryptoSelfTestMs: 0 }));
jest.mock('../frame-meter', () => ({
  useFrameMeter: () => ({ running: true, start: jest.fn(), report: null }),
}));

import { MeasureOverlay } from './overlay';
import { resetScenarioMetrics, scenarioMetricsSnapshot } from './scenario';
import {
  backgroundLiveStore,
  forgetBackgroundLive,
  recorder,
  useMeasures,
  useStalls,
} from './store';

beforeAll(async () => {
  for (const [language, resource] of Object.entries(devResources)) {
    i18n.addResourceBundle(language, 'translation', resource, true, false);
  }
  await i18n.changeLanguage('tr');
});

beforeEach(() => {
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useStalls.setState({ list: [], spans: [], watching: false });
  useMeasures.setState({ open: true });
});

afterEach(() => {
  resetScenarioMetrics();
  backgroundLiveStore.current = null;
  forgetBackgroundLive();
  useMeasures.setState({ open: false });
});

describe('the scenario measurement section', () => {
  it('shows numeric aggregates and resets them independently of background counters', async () => {
    recorder.backgroundLive({ kind: 'notice' });
    recorder.count('engine.published.read', 2);
    recorder.max('snapshot.inflight', 5);
    recorder.span('engine.fix', 7);
    await render(<MeasureOverlay />);

    expect(screen.getByText('Senaryo ölçümleri')).toBeTruthy();
    expect(screen.getByText('engine.published.read: 2')).toBeTruthy();
    expect(screen.getByText('snapshot.inflight (en yüksek): 5')).toBeTruthy();
    expect(screen.getByText('engine.fix · 1 kez · toplam 7 ms · en uzun 7 ms')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('background-reset'));
    expect(useMeasures.getState().backgroundLive.notices).toBe(0);
    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(2);

    await act(() => {
      recorder.backgroundLive({ kind: 'notice' });
    });
    await fireEvent.press(screen.getByTestId('scenario-reset'));

    expect(scenarioMetricsSnapshot().counters['engine.published.read']).toBe(0);
    expect(scenarioMetricsSnapshot().maximums['snapshot.inflight']).toBe(0);
    expect(scenarioMetricsSnapshot().spans).toEqual({});
    expect(useMeasures.getState().backgroundLive.notices).toBe(1);
  });
});
