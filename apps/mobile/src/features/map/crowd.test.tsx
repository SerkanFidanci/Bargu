import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { crowdFx } from '@/theme';

// What the pin is asked to do, kept; footprints show as a plain mark.
const mockMarker: { still: boolean | undefined } = { still: undefined };
jest.mock('@/ui/avatar-marker', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/ui/avatar-marker'),
  AvatarMarker: (props: { still?: boolean }) => {
    mockMarker.still = props.still;
    return null;
  },
}));
// The burst of a meeting draws with Skia, which has no native side here.
jest.mock('./meet-burst', () => ({ MeetBurst: () => null }));
jest.mock('./footprints', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Footprints: () => <View testID="footprints" /> };
});

import { useMapCrowd, useStillCrowd } from './crowd';
import { MapAvatar } from './map-avatar';

function Walker() {
  return (
    <MapAvatar name="Ayşe" avatar={null} activity="walking" hdg={90} spd={1.4} userId="ayse" />
  );
}

function Gliding() {
  return <Text testID="still">{String(useStillCrowd())}</Text>;
}

beforeEach(() => {
  useMapCrowd.setState({ people: 0, swarm: 0 }, true);
});

describe("a crowd on the map (the owner's 50-person test, 2026-10-23)", () => {
  it('lets a few pins move: steps, footprints, gliding', async () => {
    useMapCrowd.setState({ people: 3 });
    await render(<Walker />);
    expect(mockMarker.still).toBe(false);
    expect(screen.getByTestId('footprints')).toBeTruthy();
    await render(<Gliding />);
    expect(screen.getByTestId('still')).toHaveTextContent('false');
  });

  it(`holds pins still past ${String(crowdFx.calmAbove)}, the swarm counted too`, async () => {
    useMapCrowd.setState({ people: 3, swarm: crowdFx.calmAbove });
    await render(<Walker />);
    expect(mockMarker.still).toBe(true);
    expect(screen.queryByTestId('footprints')).toBeNull();
  });

  it(`makes pins jump instead of gliding past ${String(crowdFx.stillAbove)}`, async () => {
    useMapCrowd.setState({ people: crowdFx.stillAbove });
    await render(<Gliding />);
    expect(screen.getByTestId('still')).toHaveTextContent('false');
    useMapCrowd.setState({ people: crowdFx.stillAbove + 1 });
    await render(<Gliding />);
    expect(screen.getByTestId('still')).toHaveTextContent('true');
  });
});
