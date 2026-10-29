import { packPrice, plusPrice, purchasePrice, useStorePrices, yearlySaving } from './store-prices';

describe('Bargu+ prices, only as the store gives them (QA-42)', () => {
  afterEach(() => {
    useStorePrices.setState({ plus: {}, packs: {} });
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

  it('has a look pack price only as the store says it too', () => {
    expect(packPrice('rings')).toBeNull();
    useStorePrices.setState({ packs: { rings: { formatted: '₺34,99', micros: 34_990_000 } } });
    expect(packPrice('rings')).toBe('₺34,99');
    expect(packPrice('frames')).toBeNull();
  });

  // The PM, 2026-10-30: nobody buys, and no parent approves, what they have not seen the price of.
  it("lets a purchase go on only with a price seen: the store's, or that it is a test", () => {
    expect(purchasePrice('₺849,99', false, 'test')).toBe('₺849,99');
    expect(purchasePrice('₺849,99', true, 'test')).toBe('₺849,99');
    expect(purchasePrice(null, true, 'test')).toBe('test');
    expect(purchasePrice(undefined, true, 'test')).toBe('test');
    expect(purchasePrice(null, false, 'test')).toBeNull();
    expect(purchasePrice(undefined, false, 'test')).toBeNull();
  });
});
