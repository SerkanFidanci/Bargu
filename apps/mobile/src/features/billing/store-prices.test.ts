import { plusPrice, useStorePrices, yearlySaving } from './store-prices';

describe('Bargu+ prices, only as the store gives them (QA-42)', () => {
  afterEach(() => {
    useStorePrices.setState({ plus: {} });
  });

  it('has none until the store says, and then its own text', () => {
    expect(plusPrice('plus_year')).toBeNull();
    useStorePrices.setState({ plus: { plus_year: { formatted: '₺849,99', micros: 849_990_000 } } });
    expect(plusPrice('plus_year')).toBe('₺849,99');
    expect(plusPrice('plus_month')).toBeNull();
  });

  it('says what a year saves only when the store gives both prices', () => {
    expect(yearlySaving({})).toBeNull();
    expect(yearlySaving({ plus_year: { formatted: 'x', micros: 800_000_000 } })).toBeNull();
    expect(
      yearlySaving({
        plus_month: { formatted: 'm', micros: 100_000_000 },
        plus_year: { formatted: 'y', micros: 800_000_000 },
      }),
    ).toBe(33);
  });
});
