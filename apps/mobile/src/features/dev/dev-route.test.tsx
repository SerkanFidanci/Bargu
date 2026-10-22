import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DevRoute } from './route';
import { useDevSlots } from './slots';

// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      react.createElement(native.Text, { testID: 'redirect' }, href),
    Stack: { Screen: () => null },
  };
});

afterEach(() => {
  useDevSlots.setState({ screens: {} });
});

describe('the routes under app/_dev', () => {
  it('lead to the map where the build has no developer screen (production)', async () => {
    await render(<DevRoute name="crypto" />);
    expect(screen.getByTestId('redirect').props.children).toBe('/');
  });

  it('show the screen a developer build put in its slot, and only that one', async () => {
    useDevSlots.setState({ screens: { ui: <Text testID="gallery">gallery</Text> } });
    await render(<DevRoute name="ui" />);
    expect(screen.getByTestId('gallery')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    await render(<DevRoute name="billing" />);
    expect(screen.getByTestId('redirect')).toBeTruthy();
  });
});
