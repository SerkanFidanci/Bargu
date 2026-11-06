import { create } from 'zustand';

import {
  isScenarioCounter,
  isScenarioMaximum,
  SCENARIO_COUNTERS,
  SCENARIO_MAXIMUMS,
  type ScenarioCounter,
  type ScenarioMaximum,
} from '../../location/probe';

export interface ScenarioSpanAggregate {
  count: number;
  totalMs: number;
  maxMs: number;
}

/** In-memory scenario metrics only: fixed counters, high-water marks and named work aggregates. */
export interface ScenarioMetrics {
  counters: Record<ScenarioCounter, number>;
  maximums: Record<ScenarioMaximum, number>;
  spans: Readonly<Record<string, ScenarioSpanAggregate>>;
}

export function emptyScenarioMetrics(): ScenarioMetrics {
  return {
    counters: Object.fromEntries(SCENARIO_COUNTERS.map((name) => [name, 0])) as Record<
      ScenarioCounter,
      number
    >,
    maximums: Object.fromEntries(SCENARIO_MAXIMUMS.map((name) => [name, 0])) as Record<
      ScenarioMaximum,
      number
    >,
    spans: {},
  };
}

/** Pure counter reducer; unknown names and invalid numbers never reach the store. */
export function addScenarioCount(
  state: ScenarioMetrics,
  name: ScenarioCounter,
  delta = 1,
): ScenarioMetrics {
  if (!isScenarioCounter(name)) throw new Error('Unknown scenario counter');
  if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid scenario counter delta');
  return {
    ...state,
    counters: { ...state.counters, [name]: state.counters[name] + delta },
  };
}

/** Pure high-water reducer; a lower value leaves both the state and its identity unchanged. */
export function addScenarioMaximum(
  state: ScenarioMetrics,
  name: ScenarioMaximum,
  value: number,
): ScenarioMetrics {
  if (!isScenarioMaximum(name)) throw new Error('Unknown scenario maximum');
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid scenario maximum value');
  if (value <= state.maximums[name]) return state;
  return { ...state, maximums: { ...state.maximums, [name]: value } };
}

/** Pure span reducer. Names are fixed work names at call sites, never user data. */
export function addScenarioSpan(state: ScenarioMetrics, name: string, ms: number): ScenarioMetrics {
  const before = state.spans[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  return {
    ...state,
    spans: {
      ...state.spans,
      [name]: {
        count: before.count + 1,
        totalMs: before.totalMs + ms,
        maxMs: Math.max(before.maxMs, ms),
      },
    },
  };
}

export const useScenarioMetrics = create<ScenarioMetrics>(() => emptyScenarioMetrics());

export function recordScenarioCount(name: ScenarioCounter, delta = 1): void {
  useScenarioMetrics.setState((state) => addScenarioCount(state, name, delta));
}

export function recordScenarioMaximum(name: ScenarioMaximum, value: number): void {
  useScenarioMetrics.setState((state) => addScenarioMaximum(state, name, value));
}

export function recordScenarioSpan(name: string, ms: number): void {
  useScenarioMetrics.setState((state) => addScenarioSpan(state, name, ms));
}

/** Clears only this store: no background counters, stall state, timers or vault values are touched. */
export function resetScenarioMetrics(): void {
  useScenarioMetrics.setState(emptyScenarioMetrics(), true);
}

/** A detached numeric summary; changing it cannot mutate the in-memory store. */
export function scenarioMetricsSnapshot(): ScenarioMetrics {
  const state = useScenarioMetrics.getState();
  return {
    counters: { ...state.counters },
    maximums: { ...state.maximums },
    spans: Object.fromEntries(
      Object.entries(state.spans).map(([name, span]) => [name, { ...span }]),
    ),
  };
}
