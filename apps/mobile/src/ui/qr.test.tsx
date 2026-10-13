import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { QrCode, qrPath } from './qr-code';
import { QrScanner } from './qr-scanner';

const mockPermission = jest.fn<{ granted: boolean; canAskAgain: boolean }, []>();
const mockRequest = jest.fn(() => Promise.resolve({ granted: true }));
let mockScanned: ((result: { data: string }) => void) | undefined;

jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned?: (result: { data: string }) => void }) => {
    mockScanned = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [mockPermission(), mockRequest],
}));

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('QrCode', () => {
  it('draws the dark modules of a scannable code', () => {
    // A real token mixes cases (byte mode): version 4, 33 modules at medium error correction.
    const { size, path } = qrPath('bargu://i/' + 'aB3_-'.repeat(8) + 'xyz');
    expect(size).toBe(33);
    expect(path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });

  it('tells screen readers what the code is', async () => {
    await render(<QrCode value="bargu://i/x" size={200} label="Arkadaş ekleme QR kodu" />);
    expect(screen.getByLabelText('Arkadaş ekleme QR kodu')).toBeTruthy();
  });
});

describe('QrScanner', () => {
  it('explains the camera before asking for it', async () => {
    mockPermission.mockReturnValue({ granted: false, canAskAgain: true });
    await render(<QrScanner size={240} onScan={jest.fn()} />);
    expect(screen.getByText('Kamerayı yalnızca QR için kullanırız')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Kameraya izin ver'));
    expect(mockRequest).toHaveBeenCalled();
  });

  it('hands over each code once, and nothing while paused', async () => {
    mockPermission.mockReturnValue({ granted: true, canAskAgain: true });
    const onScan = jest.fn();
    const { rerender } = await render(<QrScanner size={240} onScan={onScan} />);
    mockScanned?.({ data: 'bargu://i/a' });
    mockScanned?.({ data: 'bargu://i/a' });
    expect(onScan).toHaveBeenCalledTimes(1);
    await rerender(<QrScanner size={240} onScan={onScan} paused />);
    expect(mockScanned).toBeUndefined();
  });
});
