import { type LocationProbe, probe } from '../../location/probe';
import { resetScenarioMetrics } from './scenario';
import { recorder } from './store';

export interface AccountRecorder {
  readonly generation: number;
  readonly listener: LocationProbe;
  deactivate(): void;
}

interface ActiveAccountRecorder extends AccountRecorder {
  readonly accountKey: string;
}

let nextGeneration = 0;
let activeGeneration = 0;
let current: ActiveAccountRecorder | null = null;

/** A recorder that accepts scenario work only while its account generation is active. */
function createAccountRecorder(accountKey: string): ActiveAccountRecorder {
  const generation = ++nextGeneration;
  activeGeneration = generation;
  let active = true;
  const accepts = () => active && activeGeneration === generation;
  const listener: LocationProbe = {
    ...recorder,
    span: (name, ms) => {
      if (accepts()) recorder.span(name, ms);
    },
    count: (name, delta) => {
      if (accepts()) recorder.count(name, delta);
    },
    max: (name, value) => {
      if (accepts()) recorder.max(name, value);
    },
  };
  return {
    accountKey,
    generation,
    listener,
    deactivate: () => {
      active = false;
      if (activeGeneration === generation) activeGeneration = 0;
    },
  };
}

/** Starts or restores the listener for this account; duplicate auth notifications lose no metrics. */
export function startAccountRecorder(accountKey: string): AccountRecorder {
  if (current?.accountKey === accountKey) {
    if (probe.current !== current.listener) probe.current = current.listener;
    return current;
  }
  stopAccountRecorder();
  const started = createAccountRecorder(accountKey);
  current = started;
  probe.current = started.listener;
  return started;
}

/** Detaches and retires the current listener before clearing only the scenario store. */
export function stopAccountRecorder(): void {
  const stopped = current;
  current = null;
  stopped?.deactivate();
  if (stopped === null || probe.current === stopped.listener) probe.current = null;
  resetScenarioMetrics();
}
