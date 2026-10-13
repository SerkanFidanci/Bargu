import { summariseFrames } from './frame-meter';

describe('summariseFrames', () => {
  it('reports a steady 60 Hz run as 60 fps without drops', () => {
    expect(summariseFrames(Array.from({ length: 300 }, () => 1000 / 60))).toEqual({
      averageFps: 60,
      worstFrameMs: 17,
      dropped: 0,
    });
  });

  it('counts frames slower than 1.5× the display rate as dropped', () => {
    const intervals = [...Array.from({ length: 98 }, () => 1000 / 120), 33, 50];
    const report = summariseFrames(intervals);
    expect(report.dropped).toBe(2);
    expect(report.worstFrameMs).toBe(50);
  });

  it('handles an empty run', () => {
    expect(summariseFrames([])).toEqual({ averageFps: 0, worstFrameMs: 0, dropped: 0 });
  });
});
