import { render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { upgradeRequired, useUpgradeRequired } from './upgrade-required';
import { UpgradeScreen } from './upgrade-screen';

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('a server that no longer serves this app (QA 19 P4)', () => {
  it('is remembered once, and the app says to update and what that means for sharing', async () => {
    expect(useUpgradeRequired.getState().required).toBe(false);
    upgradeRequired();
    upgradeRequired();
    expect(useUpgradeRequired.getState().required).toBe(true);
    await render(<UpgradeScreen />);
    expect(screen.getByText('Yeni sürüm gerekiyor')).toBeTruthy();
    expect(screen.getByText(/Güncelleyene kadar konumun paylaşılmıyor/)).toBeTruthy();
  });
});
