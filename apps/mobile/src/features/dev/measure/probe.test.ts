import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type LocationProbe, probe, timedAsync } from '../../location/probe';

function listener(): LocationProbe {
  return {
    sampled: jest.fn(),
    sent: jest.fn(),
    received: jest.fn(),
    span: jest.fn(),
    count: jest.fn(),
    max: jest.fn(),
    backgroundLive: jest.fn(),
  };
}

afterEach(() => {
  probe.current = null;
  jest.restoreAllMocks();
});

describe('timedAsync', () => {
  it('reports the whole asynchronous resolve time once and calls work once', async () => {
    const span = jest.fn();
    const current = { ...listener(), span };
    probe.current = current;
    jest.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(175);
    const work = jest.fn(() => Promise.resolve('ready'));

    await expect(timedAsync('scenario.async', work)).resolves.toBe('ready');

    expect(work).toHaveBeenCalledTimes(1);
    expect(span).toHaveBeenCalledTimes(1);
    expect(span).toHaveBeenCalledWith('scenario.async', 75);
  });

  it('reports from finally when the asynchronous work rejects, without changing the rejection', async () => {
    const span = jest.fn();
    const current = { ...listener(), span };
    probe.current = current;
    jest.spyOn(performance, 'now').mockReturnValueOnce(200).mockReturnValueOnce(260);
    const failure = new Error('offline');
    const work = jest.fn(() => Promise.reject(failure));

    await expect(timedAsync('scenario.async', work)).rejects.toBe(failure);

    expect(work).toHaveBeenCalledTimes(1);
    expect(span).toHaveBeenCalledWith('scenario.async', 60);
  });

  it('does not report after its listener has been replaced', async () => {
    const firstSpan = jest.fn();
    const secondSpan = jest.fn();
    const first = { ...listener(), span: firstSpan };
    const second = { ...listener(), span: secondSpan };
    let resolve!: (value: string) => void;
    const work = new Promise<string>((yes) => {
      resolve = yes;
    });
    probe.current = first;
    const pending = timedAsync('scenario.async', () => work);

    probe.current = second;
    resolve('done');
    await expect(pending).resolves.toBe('done');

    expect(firstSpan).not.toHaveBeenCalled();
    expect(secondSpan).not.toHaveBeenCalled();
  });

  it('without a listener only resolves the work, without reading a clock', async () => {
    const now = jest.spyOn(performance, 'now');
    const work = jest.fn(() => Promise.resolve(7));
    now.mockClear();

    const pending = timedAsync('scenario.async', work);

    expect(now).not.toHaveBeenCalled();
    await expect(pending).resolves.toBe(7);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('without a listener only rejects the work, without reading a clock', async () => {
    const now = jest.spyOn(performance, 'now');
    const failure = new Error('refused');
    const work = jest.fn(() => Promise.reject(failure));
    now.mockClear();

    const pending = timedAsync('scenario.async', work);

    expect(now).not.toHaveBeenCalled();
    await expect(pending).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('the production probe boundary', () => {
  it('imports no developer store and creates no timer', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed source within this repo
    const source = readFileSync(join(__dirname, '../../location/probe.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
    expect(imports.every((path) => !path.includes('/dev/'))).toBe(true);
    expect(source).not.toMatch(/\bset(?:Timeout|Interval)\s*\(/);
  });
});
