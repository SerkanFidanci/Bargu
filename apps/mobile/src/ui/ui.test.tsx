import i18n from '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Hand } from 'lucide-react-native';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { useState } from 'react';

import { typography } from '@/theme';

import { ACTION_LABEL_MIN_SCALE, ActionTile } from './action-tile';
import { PressableScale } from './pressable-scale';
import { Avatar, initialOf } from './avatar';
import { AvatarStack } from './avatar-stack';
import { Button } from './button';
import { CodeInput } from './code-input';
import { Confetti, useCelebration } from './confetti';
import { Segmented } from './segmented';
import { Text } from './text';
import { Toggle } from './toggle';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('Text', () => {
  it('follows the system text size up to the cap of its variant', async () => {
    await render(<Text variant="display">Bargu</Text>);
    expect(screen.getByText('Bargu').props.maxFontSizeMultiplier).toBe(typography.display.maxScale);
  });
});

describe('PressableScale', () => {
  it('draws without any style (QA 3a-B3)', async () => {
    await render(
      <PressableScale onPress={jest.fn()} testID="bare">
        <Text>Dokun</Text>
      </PressableScale>,
    );
    expect(screen.getByTestId('bare')).toBeTruthy();
  });
});

describe('ActionTile', () => {
  it('keeps its name on one line, shrinking a little rather than breaking it (Faz 9)', async () => {
    const onPress = jest.fn();
    await render(<ActionTile testID="tile" label="Yol tarifi" icon={Hand} onPress={onPress} />);
    // Its style is the pressable's own: four of them share a row equally (person card, Faz 9).
    expect(
      StyleSheet.flatten(screen.getByTestId('tile').props.style as StyleProp<ViewStyle>),
    ).toMatchObject({
      flex: 1,
    });
    const label = screen.getByText('Yol tarifi');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.minimumFontScale).toBe(ACTION_LABEL_MIN_SCALE);
    // Even at the largest system text size it is capped, then shrunk to fit.
    expect(label.props.maxFontSizeMultiplier).toBe(typography.footnote.maxScale);
    await fireEvent.press(screen.getByRole('button', { name: 'Yol tarifi' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Button', () => {
  it('is a labelled button that reacts to presses (with the requested haptic)', async () => {
    const onPress = jest.fn();
    await render(<Button label="Devam" onPress={onPress} haptic="select" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Devam' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });

  it('ignores presses and says it is busy while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Kod gönder" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Kod gönder' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('CodeInput', () => {
  function Harness({ onComplete }: { onComplete: (code: string) => void }) {
    const [value, setValue] = useState('');
    return (
      <CodeInput
        label="Giriş kodu"
        length={8}
        value={value}
        onChange={setValue}
        onComplete={onComplete}
      />
    );
  }

  it('accepts a pasted code with spaces or dashes and completes with the digits', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Giriş kodu'), '1234-5678 ');
    expect(onComplete).toHaveBeenCalledWith('12345678');
  });

  it('does not complete early and ignores letters', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Giriş kodu'), '12ab34');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Giriş kodu').props.value).toBe('1234');
  });

  it('offers the OS one-time-code autofill', async () => {
    await render(<Harness onComplete={jest.fn()} />);
    const field = screen.getByLabelText('Giriş kodu');
    expect(field.props.autoComplete).toBe('one-time-code');
    expect(field.props.textContentType).toBe('oneTimeCode');
  });
});

describe('Toggle', () => {
  it('reads as a switch with its state and flips on press', async () => {
    const onChange = jest.fn();
    await render(<Toggle label="Hayalet modu" value={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Hayalet modu' });
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Avatar', () => {
  it('uses Turkish casing for initials', () => {
    expect(initialOf('ilker')).toBe('İ');
    expect(initialOf('  ömer')).toBe('Ö');
    expect(initialOf('')).toBe('?');
  });

  it('shows the emoji when there is one, else the initial, and is named for screen readers', async () => {
    await render(<Avatar name="Can" avatar={{ color: 3, emoji: '🎸' }} />);
    expect(screen.getByRole('image', { name: 'Can' })).toBeTruthy();
    expect(screen.getByText('🎸')).toBeTruthy();
  });

  it('collapses a long stack into "+N" and reads everyone out', async () => {
    const people = ['Ayşe', 'Bora', 'Cem', 'Duru', 'Ece'].map((name, index) => ({
      id: String(index),
      name,
      avatar: null,
    }));
    await render(<AvatarStack people={people} max={3} />);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByLabelText('5 kişi: Ayşe, Bora, Cem, Duru, Ece')).toBeTruthy();
  });
});

describe('Segmented', () => {
  it('reads as a radio group with the selected choice and switches on press', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        label="Harita görünümü"
        value="auto"
        onChange={onChange}
        options={[
          { value: 'auto', label: 'Otomatik' },
          { value: 'light', label: 'Açık' },
          { value: 'dark', label: 'Koyu' },
        ]}
      />,
    );
    // The group itself stays non-focusable so its radios remain reachable one by one.
    expect(screen.getByLabelText('Harita görünümü').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Otomatik' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'Açık' }));
    expect(onChange).toHaveBeenCalledWith('light');
    await fireEvent.press(screen.getByRole('radio', { name: 'Otomatik' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('CodeInput feedback', () => {
  it('plays the error haptic when a code is rejected', async () => {
    const { rerender } = await render(
      <CodeInput label="Giriş kodu" length={4} value="" onChange={jest.fn()} />,
    );
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith('error');
    await rerender(
      <CodeInput label="Giriş kodu" length={4} value="" onChange={jest.fn()} phase="wrong" />,
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });
});

describe('celebration', () => {
  it('is requested once, played by the map, then cleared', () => {
    expect(useCelebration.getState().pending).toBe(false);
    useCelebration.getState().celebrate();
    expect(useCelebration.getState().pending).toBe(true);
    useCelebration.getState().done();
    expect(useCelebration.getState().pending).toBe(false);
  });

  it('never blocks touches on the map', async () => {
    const { toJSON } = await render(<Confetti onDone={jest.fn()} />);
    expect(toJSON()).toMatchObject({ props: { pointerEvents: 'none' } });
  });
});
