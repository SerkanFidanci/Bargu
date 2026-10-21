import { render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { AvatarMarker } from './avatar-marker';

const SPEED = { kind: 'speed', kmh: 40 } as const;

describe('the line under someone on the map (proje sahibi 2026-10-16)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('shows the speed of a live location, and reads it out with the rest', async () => {
    await render(<AvatarMarker name="Ayşe" avatar={null} activity="driving" detail={SPEED} />);
    expect(screen.getByText('40 km/sa')).toBeTruthy();
    expect(screen.getByLabelText('Ayşe, canlı konum, araçta, saatte 40 km')).toBeTruthy();
  });

  it('shows the age of an old location instead, and nothing inside a shared frame', async () => {
    const { rerender } = await render(
      <AvatarMarker name="Ayşe" avatar={null} staleMinutes={12} detail={SPEED} />,
    );
    expect(screen.queryByTestId('marker-detail')).toBeNull();
    expect(screen.getByText('12 dk')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} detail={SPEED} framed />);
    expect(screen.queryByTestId('marker-detail')).toBeNull();
  });
});

describe('what someone is doing, drawn (the owner, 2026-10-21)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it.each([
    ['walking', 'yürüyor'],
    ['cycling', 'bisiklette'],
    ['driving', 'araçta'],
    ['racing', 'hızlı araçta'],
    ['train', 'trende'],
    ['plane', 'uçakta'],
  ] as const)('draws %s and reads it out as "%s"', async (activity, said) => {
    await render(<AvatarMarker name="Ayşe" avatar={null} activity={activity} speed={30} />);
    expect(screen.getByTestId(`activity-${activity}`)).toBeTruthy();
    expect(screen.getByLabelText(`Ayşe, canlı konum, ${said}`)).toBeTruthy();
  });

  it('draws nothing for someone still, or whose location is old', async () => {
    const { rerender } = await render(<AvatarMarker name="Ayşe" avatar={null} />);
    expect(screen.queryByTestId(/^activity-/)).toBeNull();
    await rerender(
      <AvatarMarker name="Ayşe" avatar={null} activity="racing" speed={40} staleMinutes={30} />,
    );
    expect(screen.queryByTestId(/^activity-/)).toBeNull();
  });
});

describe('a person as a pin (the owner, 2026-10-18)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('wears the green live dot only while the location is fresh, also in a shared pin', async () => {
    const { rerender } = await render(<AvatarMarker name="Ayşe" avatar={null} />);
    expect(screen.getByTestId('marker-live')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} staleMinutes={90} />);
    expect(screen.queryByTestId('marker-live')).toBeNull();
    expect(screen.getByText('1 sa')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} framed />);
    expect(screen.getByTestId('marker-live')).toBeTruthy();
  });
});
