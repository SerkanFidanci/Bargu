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

describe('why an old location is old ("Neden eski?", docs/ADR/0028)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it.each([
    ['saver', 'Pil tasarrufu'],
    ['permission', 'Konum izni kapalı'],
    ['nofix', 'Konum alınamıyor'],
    ['offline', 'Çevrim dışı'],
  ] as const)('writes %s next to the age, and reads it out', async (why, said) => {
    await render(<AvatarMarker name="Ayşe" avatar={null} staleMinutes={23} why={why} />);
    expect(screen.getByText(`23 dk · ${said}`)).toBeTruthy();
    expect(screen.getByLabelText(`Ayşe, 23 dakika önceki konum, ${said}`)).toBeTruthy();
  });

  it('counts hours as before, and says nothing of a reason beside a fresh location', async () => {
    const { rerender } = await render(
      <AvatarMarker name="Ayşe" avatar={null} staleMinutes={190} why="saver" />,
    );
    expect(screen.getByText('3 sa · Pil tasarrufu')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} why="saver" />);
    expect(screen.queryByText(/Pil tasarrufu/)).toBeNull();
    expect(screen.getByLabelText('Ayşe, canlı konum')).toBeTruthy();
  });

  it('keeps the pill to the age inside a shared frame, and still reads the reason out', async () => {
    await render(<AvatarMarker name="Ayşe" avatar={null} staleMinutes={23} why="nofix" framed />);
    expect(screen.getByText('23 dk')).toBeTruthy();
    expect(screen.queryByText(/Konum alınamıyor/)).toBeNull();
    expect(screen.getByLabelText('Ayşe, 23 dakika önceki konum, Konum alınamıyor')).toBeTruthy();
  });

  it('is in English too', async () => {
    await i18n.changeLanguage('en');
    const view = await render(
      <AvatarMarker name="Ayşe" avatar={null} staleMinutes={23} why="permission" />,
    );
    try {
      expect(screen.getByText('23 min · Location permission off')).toBeTruthy();
    } finally {
      // Off the screen first: a language change under a mounted screen is an update outside act().
      await view.unmount();
      await i18n.changeLanguage('tr');
    }
  });
});

describe('a story on the pin (docs/ADR/0035 §8)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it('wears a ring outside its own and says so, new or seen; none in a shared frame', async () => {
    const { rerender } = await render(<AvatarMarker name="Ayşe" avatar={null} story="new" />);
    expect(screen.getByTestId('marker-story')).toBeTruthy();
    expect(screen.getByLabelText('Ayşe, canlı konum, yeni hikayesi var')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} story="seen" />);
    expect(screen.getByLabelText('Ayşe, canlı konum, hikayesi var')).toBeTruthy();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} story="new" framed />);
    expect(screen.queryByTestId('marker-story')).toBeNull();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} />);
    expect(screen.queryByTestId('marker-story')).toBeNull();
  });
});
