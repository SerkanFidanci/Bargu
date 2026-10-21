import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LIVE_EVENTS, SERVER_EVENT_TYPES } from '@bargu/schemas';

import { INTENTIONALLY_NOT_HANDLED_EVENTS } from './event-stream';
import { INTENTIONALLY_NOT_LISTENED, LIVE_MESSAGES } from './socket-transport';

/**
 * The contract between the names the server sends and the app's listeners. The API can emit only
 * the names in LIVE_EVENTS (its emit functions take a `LiveEvent`) and publish only a `ServerEvent`,
 * so a new message there must reach this test: if the app forgets it, CI fails. `place` and `history`
 * were handled since Faz 7 but never listened to, so an open app missed arrivals, "geç kalıyorum",
 * "Geldim" and history updates (the server pushes only to closed apps).
 *
 * How handlers are found, by reading the app's source (so they must be written this way):
 *  - a live message: `name === 'x'` in a file that calls `onLiveMessage(`;
 *  - a stream event: `event.type === 'x'` in a file that calls `onServerEvents(`, or in
 *    features/circles/circle-sync.ts outside the branch that only skips events another module owns.
 */

const SRC = join(__dirname, '../..');
const NAME = '[a-z]+(?:\\.[a-z]+)*';

interface Source {
  /** Path under src, with forward slashes. */
  path: string;
  /** Without comments, so a commented-out handler does not count. */
  text: string;
}

let cache: Source[] | null = null;
function sources(): Source[] {
  if (cache !== null) return cache;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source folder, a fixed path
  const paths = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path));
  cache = paths.map((path) => ({
    path,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files
    text: readFileSync(join(SRC, path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, ''),
  }));
  return cache;
}

/**
 * Who handles what: name → the files that do, among the files that call `registration` (and the
 * `extra` ones). Only names in `only` count, when it is given.
 */
function handlers(
  registration: RegExp,
  comparison: RegExp,
  only?: readonly string[],
  extra: readonly Source[] = [],
): { byName: Map<string, string[]>; files: Source[] } {
  const files = sources().filter(
    (source) => registration.test(source.text) && source.path !== 'features/live/live-session.ts',
  );
  const byName = new Map<string, string[]>();
  for (const source of [...files, ...extra]) {
    for (const match of source.text.matchAll(comparison)) {
      const name = match[1];
      if (name === undefined || (only !== undefined && !only.includes(name))) continue;
      byName.set(name, [...(byName.get(name) ?? []), source.path]);
    }
  }
  return { byName, files };
}

const knownLive: readonly string[] = LIVE_EVENTS;
const knownTypes: readonly string[] = SERVER_EVENT_TYPES;
const listened: readonly string[] = LIVE_MESSAGES;
const notListened: Readonly<Record<string, string>> = INTENTIONALLY_NOT_LISTENED;
const notHandled: Readonly<Record<string, string>> = INTENTIONALLY_NOT_HANDLED_EVENTS;

/** Every `name === 'x'` counts, so a handler for a name nobody sends shows up as well. */
function liveHandlers() {
  return handlers(/\bonLiveMessage\(/, new RegExp(`\\bname === '(${NAME})'`, 'g'));
}

/**
 * circle-sync applies the stream's circle events. Its first branch only skips the types that have
 * their own sync (places, documents, guardians, plan): that is not handling them.
 */
function circleSync(): Source[] {
  return sources()
    .filter((source) => source.path === 'features/circles/circle-sync.ts')
    .map((source) => ({
      ...source,
      text: source.text.replace(/if \([^)]*\) \{\s*continue;\s*\}/g, ''),
    }));
}

function eventHandlers() {
  return handlers(
    /\bonServerEvents\(/,
    new RegExp(`\\.type === '(${NAME})'`, 'g'),
    knownTypes,
    circleSync(),
  );
}

describe('live messages (the names of emitLive and emitAll)', () => {
  it('listens to every message the server sends, or says why not', () => {
    const forgotten = LIVE_EVENTS.filter(
      (name) => !listened.includes(name) && !(name in notListened),
    ).map(
      (name) =>
        `'${name}' is sent by the server and the app neither listens to it (add it to LIVE_MESSAGES in socket-transport.ts and handle it) nor lists it in INTENTIONALLY_NOT_LISTENED`,
    );
    expect(forgotten).toEqual([]);
  });

  it('never both listens to a message and lists it as not listened to', () => {
    expect(Object.keys(notListened).filter((name) => listened.includes(name))).toEqual([]);
  });

  it('names only messages the server sends, once each', () => {
    expect(listened.filter((name) => !knownLive.includes(name))).toEqual([]);
    expect(Object.keys(notListened).filter((name) => !knownLive.includes(name))).toEqual([]);
    expect(new Set(listened).size).toBe(listened.length);
  });

  it('says why for every message it does not listen to', () => {
    for (const [name, reason] of Object.entries(notListened)) {
      expect({ name, long: reason.length >= 40 }).toEqual({ name, long: true });
    }
  });

  it('has a handler for every message it listens to', () => {
    const { byName } = liveHandlers();
    expect(
      listened
        .filter((name) => !byName.has(name))
        .map((name) => `'${name}' is listened to but nothing handles it (name === '${name}')`),
    ).toEqual([]);
  });

  it('has no handler for a message it does not listen to', () => {
    const { byName } = liveHandlers();
    expect(
      [...byName.keys()]
        .filter((name) => !listened.includes(name))
        .map((name) => `'${name}' has a handler but is not in LIVE_MESSAGES: it never arrives`),
    ).toEqual([]);
  });

  it('finds the handlers it checks (a handler written another way would hide from it)', () => {
    const { byName, files } = liveHandlers();
    expect(files.length).toBeGreaterThan(0);
    expect(byName.size).toBeGreaterThan(5);
    // Every file that registers a live listener must be seen handling something.
    const silent = files.filter(
      (file) => ![...byName.values()].some((paths) => paths.includes(file.path)),
    );
    expect(silent.map((file) => file.path)).toEqual([]);
  });
});

describe('stream events (the durable events)', () => {
  it('handles every event type the server publishes, or says why not', () => {
    const { byName } = eventHandlers();
    const forgotten = SERVER_EVENT_TYPES.filter(
      (type) => !byName.has(type) && !(type in notHandled),
    ).map(
      (type) =>
        `'${type}' is published by the server and the app neither handles it (event.type === '${type}' in a file that calls onServerEvents, or in circle-sync) nor lists it in INTENTIONALLY_NOT_HANDLED_EVENTS`,
    );
    expect(forgotten).toEqual([]);
  });

  it('never both handles a type and lists it as not handled', () => {
    const { byName } = eventHandlers();
    expect(Object.keys(notHandled).filter((type) => byName.has(type))).toEqual([]);
  });

  it('lists only types the server publishes, each with a reason', () => {
    expect(Object.keys(notHandled).filter((type) => !knownTypes.includes(type))).toEqual([]);
    for (const [type, reason] of Object.entries(notHandled)) {
      expect({ type, long: reason.length >= 40 }).toEqual({ type, long: true });
    }
  });

  it('finds the handlers it checks (a handler written another way would hide from it)', () => {
    const { byName, files } = eventHandlers();
    expect(files.length).toBeGreaterThan(0);
    expect(byName.size).toBeGreaterThan(3);
    const silent = files.filter(
      (file) => ![...byName.values()].some((paths) => paths.includes(file.path)),
    );
    expect(silent.map((file) => file.path)).toEqual([]);
  });
});
