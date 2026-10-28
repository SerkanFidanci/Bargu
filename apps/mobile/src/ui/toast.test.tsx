import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

import '@/i18n';
import { duration, space } from '@/theme';

import { ClearOfToast, toast, ToastHost, useToasts } from './toast';

const shift = () => {
  const style = getAnimatedStyle(screen.getByTestId('clear-of-toast'));
  const [move] = (style.transform ?? []) as { translateY?: number }[];
  return move?.translateY;
};

beforeEach(() => {
  jest.useFakeTimers();
  useToasts.setState({ current: null, room: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('what is under the toast (the owner, 2026-10-28)', () => {
  it('moves down out of its way while it shows, as far as it is tall, and back after', async () => {
    await render(
      <>
        <ClearOfToast>
          <Text>who sees me · the weather</Text>
        </ClearOfToast>
        <ToastHost />
      </>,
    );
    expect(shift()).toBe(0);

    await act(() => {
      toast.notice('Ada çembere katıldı', 'info', jest.fn());
    });
    await fireEvent(screen.getByTestId('toast'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 52 } },
    });
    expect(useToasts.getState().room).toBe(52);
    await act(() => {
      jest.advanceTimersByTime(duration.base + duration.fast);
    });
    expect(shift()).toBe(52 + space.sm);

    // Gone (here by its own timer): the room is given back.
    await act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(useToasts.getState().current).toBeNull();
    expect(useToasts.getState().room).toBe(0);
    await act(() => {
      jest.advanceTimersByTime(duration.base + duration.fast);
    });
    expect(shift()).toBe(0);
  });

  it('takes the size of the toast shown only, not of one already gone', async () => {
    await act(() => {
      toast.info('first');
    });
    const first = useToasts.getState().current?.id ?? -1;
    await act(() => {
      toast.info('second');
    });
    useToasts.getState().measured(first, 90);
    expect(useToasts.getState().room).toBe(0);
    useToasts.getState().dismiss(first);
    expect(useToasts.getState().current?.message).toBe('second');
  });
});
