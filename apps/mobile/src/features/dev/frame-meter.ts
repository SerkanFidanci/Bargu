import { useEffect, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export interface FrameReport {
  averageFps: number;
  /** Longest gap between two frames (ms): the worst stutter seen. */
  worstFrameMs: number;
  /** Frames that took more than 1.5× the display's frame time. */
  dropped: number;
}

/** Summarises UI-thread frame intervals (ms). The display rate is taken from the median. */
export function summariseFrames(intervals: readonly number[]): FrameReport {
  if (intervals.length === 0) return { averageFps: 0, worstFrameMs: 0, dropped: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const total = intervals.reduce((sum, value) => sum + value, 0);
  return {
    averageFps: Math.round((intervals.length / total) * 1000),
    worstFrameMs: Math.round(sorted[sorted.length - 1] ?? 0),
    dropped: intervals.filter((value) => value > median * 1.5).length,
  };
}

/**
 * Measures the UI thread's frame rate for a few seconds (Faz 3 DoD: transitions at 60 fps). Runs
 * as a frame callback on the UI thread, so it sees exactly what animations see.
 */
export function useFrameMeter(seconds: number) {
  const intervals = useSharedValue<number[]>([]);
  const elapsed = useSharedValue(0);
  const done = useSharedValue(true);
  const [report, setReport] = useState<FrameReport | null>(null);
  const [running, setRunning] = useState(false);

  const finish = (values: number[]) => {
    setRunning(false);
    setReport(summariseFrames(values));
  };

  const callback = useFrameCallback((frame) => {
    const interval = frame.timeSincePreviousFrame;
    if (done.get() || interval === null) return;
    intervals.set([...intervals.get(), interval]);
    elapsed.set(elapsed.get() + interval);
    if (elapsed.get() >= seconds * 1000) {
      done.set(true);
      scheduleOnRN(finish, intervals.get());
    }
  }, false);

  useEffect(() => {
    callback.setActive(running);
  }, [callback, running]);

  const start = () => {
    intervals.set([]);
    elapsed.set(0);
    done.set(false);
    setReport(null);
    setRunning(true);
  };

  return { start, running, report };
}
