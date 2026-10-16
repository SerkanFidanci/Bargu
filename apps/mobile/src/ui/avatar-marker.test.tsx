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
    await rerender(<AvatarMarker name="Ayşe" avatar={null} detail={SPEED} framed island={false} />);
    expect(screen.queryByTestId('marker-detail')).toBeNull();
  });
});
