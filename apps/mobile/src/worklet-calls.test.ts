import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Animations run as worklets on the UI thread (CLAUDE.md). A worklet that calls a plain function
 * of ours throws there on every frame; jest runs worklets on the JS thread, where the same call
 * works, so no render test sees it. bc5f925 shipped one (the activity drawing's rotation helper)
 * and froze the phone. This reads the source instead: every function of ours called from code that
 * runs on the UI thread must itself be a worklet. That code is:
 *
 * - the callback of useAnimatedStyle, useAnimatedProps, useDerivedValue and useFrameCallback;
 * - the completion callback of withTiming, withSpring, withDecay and withRepeat;
 * - the callbacks of a gesture (Gesture.Pan().onUpdate(...) and the like), unless the gesture says
 *   runOnJS(true);
 * - and whatever a worklet calls in its turn.
 *
 * Functions are found where they are defined, in the same file or in the file an import comes from,
 * also through files that only re-export them (`export { x } from`, `export * from`).
 *
 * QA 27 B-3: the check first missed re-exports, completion callbacks and gestures. The checker is
 * a function of the files it is given, so the last describe feeds it small fixtures, one per case.
 */

const SRC = resolve(__dirname);

/** Absolute path → text of the source files the check can look into. */
type Sources = ReadonlyMap<string, string>;

const HOOKS = /\b(useAnimatedStyle|useAnimatedProps|useDerivedValue|useFrameCallback)\(/g;
/** Where the completion callback is among the arguments of each animation. */
const COMPLETION_AT: Readonly<Record<string, number>> = {
  withTiming: 2,
  withSpring: 2,
  withDecay: 1,
  withRepeat: 3,
};
const ANIMATIONS = /\b(with[A-Z]\w*)\(/g;
const GESTURE_CALLBACKS = new Set([
  'onBegin',
  'onStart',
  'onUpdate',
  'onChange',
  'onEnd',
  'onFinalize',
]);

function readTree(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
    if (statSync(path).isDirectory()) {
      for (const [file, text] of readTree(path)) found.set(file, text);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
      found.set(path, readFileSync(path, 'utf8'));
    }
  }
  return found;
}

/** The text of the balanced (…) or {…} starting at `open`. */
function balanced(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  const close = pairs[text[open] ?? ''];
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === text[open]) depth++;
    else if (text[index] === close) depth--;
    if (depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

/** The arguments of a call, from its balanced (…): split at the commas outside any brackets. */
function argumentsOf(call: string): string[] {
  const inner = call.slice(1, call.endsWith(')') ? -1 : undefined);
  const found: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < inner.length; index++) {
    const char = inner.charAt(index);
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === ',' && depth === 0) {
      found.push(inner.slice(from, index));
      from = index + 1;
    }
  }
  found.push(inner.slice(from));
  return found.map((argument) => argument.trim()).filter((argument) => argument !== '');
}

/** Module-level functions of a file: name → body. */
function definitions(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(/^(?:export )?function (\w+)/gm)) {
    const name = match[1];
    if (name === undefined) continue;
    // function name<T>(params): type { body }: the body is the brace after the parameters.
    const open = text.indexOf('(', match.index + match[0].length);
    let at = open + balanced(text, open).length;
    at += /^\s*/.exec(text.slice(at))?.[0].length ?? 0;
    // A return type written as an object ({ thigh: number }) is not the body.
    if (text[at] === ':') {
      at += 1 + (/^\s*/.exec(text.slice(at + 1))?.[0].length ?? 0);
      if (text[at] === '{') at += balanced(text, at).length;
    }
    found.set(name, balanced(text, text.indexOf('{', at)));
  }
  // const name = (params) => body: a block, or an expression to the end of its line.
  for (const match of text.matchAll(/^(?:export )?const (\w+)[^\n]*?=>/gm)) {
    const name = match[1];
    if (name === undefined) continue;
    const end = match.index + match[0].length;
    const at = end + (/^\s*/.exec(text.slice(end))?.[0].length ?? 0);
    found.set(name, text[at] === '{' ? balanced(text, at) : text.slice(at, text.indexOf('\n', at)));
  }
  return found;
}

/** `a, type B, c as d` of an import or export list: the name used, and the one it comes from. */
function specifiers(list: string): { name: string; original: string }[] {
  return list.split(',').flatMap((part) => {
    const pieces = part
      .replace(/^\s*type\s+/, '')
      .trim()
      .split(/\s+as\s+/);
    const original = pieces[0]?.trim();
    const name = (pieces[1] ?? pieces[0])?.trim();
    return original !== undefined && name !== undefined && name !== '' ? [{ name, original }] : [];
  });
}

/** Whether `text` is a function written out (not a name, not a call that returns one). */
function isFunctionExpression(text: string): boolean {
  const head = text.replace(/^async\s+/, '');
  if (/^function\b/.test(head)) return true;
  // Before the arrow: one name, or a parameter list (with a return type, perhaps).
  const arrow = head.indexOf('=>');
  if (arrow === -1) return false;
  const before = head.slice(0, arrow).trim();
  if (/^[\w$]+$/.test(before)) return true;
  if (!before.startsWith('(')) return false;
  const rest = before.slice(balanced(before, 0).length).trim();
  return rest === '' || rest.startsWith(':');
}

/** Plain calls in a piece of code (not methods: Math.sin, phase.get). */
function calls(code: string): string[] {
  return [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1] ?? '');
}

/** The kinds of code that run on the UI thread, as the check finds them. */
type Kind = 'hook' | 'completion' | 'gesture';

interface Report {
  /** One line for each plain function a UI-thread piece of code calls. */
  problems: string[];
  /** How many pieces of UI-thread code of each kind the check looked into. */
  looked: Record<Kind, number>;
}

/**
 * Reads `sources` (`root` is what `@/` stands for) and reports every plain function that code
 * running on the UI thread calls.
 */
function check(sources: Sources, root: string): Report {
  const shown = (file: string) => relative(root, file).replaceAll('\\', '/');
  const definitionsOf = new Map<string, Map<string, string>>();
  const definedIn = (file: string) => {
    let known = definitionsOf.get(file);
    if (known === undefined) {
      known = definitions(sources.get(file) ?? '');
      definitionsOf.set(file, known);
    }
    return known;
  };

  /** The file a local import (`./x`, `@/x`) points at, when it is one of ours. */
  const moduleOf = (from: string, spec: string) => {
    const base = spec.startsWith('@/') ? join(root, spec.slice(2)) : resolve(dirname(from), spec);
    return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
      .map((candidate) => resolve(candidate))
      .find((candidate) => sources.has(candidate));
  };

  /** Local imports of a file: the name used → the file and the name it has there. */
  const importsOf = (file: string, text: string) => {
    const found = new Map<string, { file: string; original: string }>();
    for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'((?:\.|@\/)[^']+)'/g)) {
      const target = moduleOf(file, match[2] ?? '');
      if (target === undefined) continue;
      for (const { name, original } of specifiers(match[1] ?? ''))
        found.set(name, { file: target, original });
    }
    return found;
  };

  /** What a file hands on from other files: `export { a as b } from`, `export * from`. */
  const reexportsOf = (file: string, text: string) => {
    const named = new Map<string, { file: string; original: string }>();
    const all: string[] = [];
    // (Prettier writes these with single spaces, as below.)
    for (const match of text.matchAll(/^export (?:type )?\{([^}]+)\} from '((?:\.|@\/)[^']+)'/gm)) {
      const target = moduleOf(file, match[2] ?? '');
      if (target === undefined) continue;
      for (const { name, original } of specifiers(match[1] ?? ''))
        named.set(name, { file: target, original });
    }
    for (const match of text.matchAll(/^export \* from '((?:\.|@\/)[^']+)'/gm)) {
      const target = moduleOf(file, match[1] ?? '');
      if (target !== undefined) all.push(target);
    }
    return { named, all };
  };

  /** The function `name` that `file` defines or hands on from another file, however far. */
  const exported = (
    file: string,
    name: string,
    seen = new Set<string>(),
  ): { file: string; body: string } | undefined => {
    const key = `${file}#${name}`;
    const text = sources.get(file);
    if (seen.has(key) || text === undefined) return undefined;
    seen.add(key);
    const body = definedIn(file).get(name);
    if (body !== undefined) return { file, body };
    const { named, all } = reexportsOf(file, text);
    const through = named.get(name) ?? importsOf(file, text).get(name);
    if (through !== undefined) {
      const found = exported(through.file, through.original, seen);
      if (found !== undefined) return found;
    }
    for (const star of all) {
      const found = exported(star, name, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const problems = new Set<string>();
  const checked = new Set<string>();
  const inspect = (file: string, code: string, where: string) => {
    const text = sources.get(file) ?? '';
    const imported = importsOf(file, text);
    for (const name of calls(code)) {
      // Components and hooks are not called from worklets; skip what looks like one.
      if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) continue;
      const own = definedIn(file).get(name);
      const from = imported.get(name);
      const target =
        own !== undefined
          ? { file, body: own }
          : from === undefined
            ? undefined
            : exported(from.file, from.original);
      if (target === undefined) continue;
      if (!/['"]worklet['"]/.test(target.body)) {
        problems.add(`${where} calls ${name} (${shown(target.file)}), not a worklet`);
        continue;
      }
      const key = `${target.file}#${name}`;
      if (checked.has(key)) continue;
      checked.add(key);
      inspect(target.file, target.body, name);
    }
  };

  const looked: Record<Kind, number> = { hook: 0, completion: 0, gesture: 0 };
  /**
   * A callback as an argument: written out, or a function passed by name (then it is what gets
   * called). Anything else (a number, a config, scheduleOnRN(f)) is not code that runs there.
   */
  const checkCallback = (kind: Kind, file: string, argument: string | undefined, where: string) => {
    if (argument === undefined) return;
    const code = isFunctionExpression(argument)
      ? argument
      : /^[A-Za-z_$][\w$]*$/.test(argument)
        ? `${argument}()`
        : undefined;
    if (code === undefined) return;
    looked[kind] += 1;
    inspect(file, code, where);
  };

  for (const [file, text] of sources) {
    for (const match of text.matchAll(HOOKS)) {
      const open = match.index + match[0].length - 1;
      looked.hook += 1;
      inspect(file, balanced(text, open), `${shown(file)} ${match[1] ?? ''}`);
    }
    for (const match of text.matchAll(ANIMATIONS)) {
      const name = match[1] ?? '';
      const open = match.index + match[0].length - 1;
      const at = COMPLETION_AT[name];
      if (at === undefined) continue;
      checkCallback(
        'completion',
        file,
        argumentsOf(balanced(text, open))[at],
        `${shown(file)} ${name} callback`,
      );
    }
    // Gesture.Pan().onUpdate(…).onEnd(…): the callbacks of one chain.
    for (const match of text.matchAll(/\bGesture\.(\w+)\(/g)) {
      const links: { name: string; call: string }[] = [];
      let at = match.index + match[0].length - 1;
      at += balanced(text, at).length;
      let next = /^\s*\.(\w+)\s*\(/.exec(text.slice(at));
      while (next !== null) {
        const open = at + next[0].length - 1;
        const call = balanced(text, open);
        links.push({ name: next[1] ?? '', call });
        at = open + call.length;
        next = /^\s*\.(\w+)\s*\(/.exec(text.slice(at));
      }
      // runOnJS(true): the gesture's callbacks run on the JavaScript thread, plain functions allowed.
      if (links.some((link) => link.name === 'runOnJS' && /^\(\s*true\s*\)$/.test(link.call)))
        continue;
      for (const link of links) {
        if (!GESTURE_CALLBACKS.has(link.name)) continue;
        for (const argument of argumentsOf(link.call))
          checkCallback(
            'gesture',
            file,
            argument,
            `${shown(file)} Gesture.${match[1] ?? ''} ${link.name}`,
          );
      }
    }
  }
  return { problems: [...problems], looked };
}

/** The checker on a few files that do not exist on disk (`name` is relative to src). */
const FIXTURE_ROOT = join(SRC, '__fixture__');
function fixture(files: Record<string, string>): Report {
  return check(
    new Map(
      Object.entries(files).map(([name, text]) => [resolve(FIXTURE_ROOT, name), text] as const),
    ),
    FIXTURE_ROOT,
  );
}

describe('worklets call only worklets (the freeze of bc5f925)', () => {
  it('every function of ours that code on the UI thread calls is a worklet', () => {
    const { problems, looked } = check(readTree(SRC), SRC);
    expect(problems).toEqual([]);
    // The check is looking at something in every kind (it would also pass when it found nothing).
    expect(looked.hook).toBeGreaterThan(10);
    expect(looked.completion).toBeGreaterThan(0);
    expect(looked.gesture).toBeGreaterThan(0);
  });
});

// QA 27 B-3: each gap the check had has a small fixture that fails without it. A plain function is
// called from the UI-thread code of that kind, and the check must say so; with a worklet instead,
// it must say nothing.
describe('the check itself (QA 27 B-3)', () => {
  const plain = { 'ui/math.ts': 'export function wobble(x: number) { return x * 2; }' };
  const worklet = {
    'ui/math.ts': "export function wobble(x: number) { 'worklet'; return x * 2; }",
  };
  const spinner = (call: string, from = '@/ui') =>
    `import { ${call.split('(')[0] ?? ''} } from '${from}';
export function Spinner() {
  return useAnimatedStyle(() => ({ rotate: ${call} }));
}`;

  it('still finds a plain function called from an animation hook, and a plain one behind a worklet', () => {
    expect(
      fixture({ ...plain, 'ui/spinner.tsx': spinner('wobble(1)', './math') }).problems,
    ).toEqual(['ui/spinner.tsx useAnimatedStyle calls wobble (ui/math.ts), not a worklet']);
    expect(
      fixture({ ...worklet, 'ui/spinner.tsx': spinner('wobble(1)', './math') }).problems,
    ).toEqual([]);
    expect(
      fixture({
        'ui/math.ts': `export function wobble(x: number) { 'worklet'; return inner(x); }
function inner(x: number) { return x; }`,
        'ui/spinner.tsx': spinner('wobble(1)', './math'),
      }).problems,
    ).toEqual(['wobble calls inner (ui/math.ts), not a worklet']);
  });

  describe('functions imported through a file that only re-exports them', () => {
    it.each([
      ['export { wobble } from', "export { wobble } from './math';"],
      ['export type-list and the function', "export { type Spin, wobble } from './math';"],
      ['export * from', "export * from './math';"],
    ])('%s', (_name, barrel) => {
      expect(
        fixture({ ...plain, 'ui/index.ts': barrel, 'ui/spinner.tsx': spinner('wobble(1)') })
          .problems,
      ).toEqual(['ui/spinner.tsx useAnimatedStyle calls wobble (ui/math.ts), not a worklet']);
      expect(
        fixture({ ...worklet, 'ui/index.ts': barrel, 'ui/spinner.tsx': spinner('wobble(1)') })
          .problems,
      ).toEqual([]);
    });

    it('follows a renamed export and a barrel of barrels', () => {
      expect(
        fixture({
          ...plain,
          'ui/index.ts': "export { wobble as spin } from './math';",
          'ui/spinner.tsx': spinner('spin(1)'),
        }).problems,
      ).toEqual(['ui/spinner.tsx useAnimatedStyle calls spin (ui/math.ts), not a worklet']);
      expect(
        fixture({
          'ui/parts/math.ts': plain['ui/math.ts'],
          'ui/parts/index.ts': "export { wobble } from './math';",
          'ui/index.ts': "export * from './parts';",
          'app/spinner.tsx': spinner('wobble(1)'),
        }).problems,
      ).toEqual([
        'app/spinner.tsx useAnimatedStyle calls wobble (ui/parts/math.ts), not a worklet',
      ]);
    });

    it('follows an import that is exported again, and stops at barrels that export each other', () => {
      expect(
        fixture({
          ...plain,
          'ui/index.ts': "import { wobble } from './math';\nexport { wobble };",
          'ui/spinner.tsx': spinner('wobble(1)'),
        }).problems,
      ).toEqual(['ui/spinner.tsx useAnimatedStyle calls wobble (ui/math.ts), not a worklet']);
      expect(
        fixture({
          'a/index.ts': "export * from '@/b';",
          'b/index.ts': "export * from '@/a';",
          'ui/spinner.tsx': spinner('wobble(1)', '@/a'),
        }).problems,
      ).toEqual([]);
    });
  });

  describe('the completion callbacks of the animation functions', () => {
    const notify = { 'ui/notify.ts': 'export function notify(done?: boolean) { return done; }' };
    const notifyWorklet = {
      'ui/notify.ts': "export function notify(done?: boolean) { 'worklet'; return done; }",
    };
    const fx = (call: string) => `import { notify } from './notify';
export function run(value: { value: number }) {
  value.value = ${call};
}`;

    it.each([
      ['withTiming', 'withTiming(1, { duration: 200 }, (finished) => { notify(finished); })'],
      ['withSpring', 'withSpring(1, config, (finished) => { notify(finished); })'],
      ['withDecay', 'withDecay({ velocity: 1 }, () => { notify(); })'],
      ['withRepeat', 'withRepeat(withTiming(1), -1, true, () => { notify(); })'],
      ['withTiming (a function)', 'withTiming(1, {}, function (done) { notify(done); })'],
    ])('%s', (name, call) => {
      const callback = name.split(' ')[0] ?? '';
      expect(fixture({ ...notify, 'ui/fx.tsx': fx(call) }).problems).toEqual([
        `ui/fx.tsx ${callback} callback calls notify (ui/notify.ts), not a worklet`,
      ]);
      expect(fixture({ ...notifyWorklet, 'ui/fx.tsx': fx(call) }).problems).toEqual([]);
    });

    it('checks a callback given by name, and leaves the rest of the arguments alone', () => {
      const named = `function done() { return 1; }
export function run(value: { value: number }) {
  value.value = withTiming(1, {}, done);
}`;
      expect(fixture({ 'ui/fx.tsx': named }).problems).toEqual([
        'ui/fx.tsx withTiming callback calls done (ui/fx.tsx), not a worklet',
      ]);
      expect(
        fixture({ 'ui/fx.tsx': named.replace('{ return', "{ 'worklet'; return") }).problems,
      ).toEqual([]);
      // The target value is worked out on the thread that calls withTiming, not on the UI thread.
      expect(
        fixture({ ...notify, 'ui/fx.tsx': fx('withTiming(notify(1), notify(2))') }).problems,
      ).toEqual([]);
    });

    it('lets a callback hand the work to the JavaScript thread', () => {
      expect(
        fixture({
          ...notify,
          'ui/fx.tsx': fx('withTiming(1, {}, (finished) => { scheduleOnRN(notify, finished); })'),
        }).problems,
      ).toEqual([]);
      expect(
        fixture({
          ...notify,
          'ui/fx.tsx': fx('withTiming(1, {}, (finished) => { runOnJS(notify)(finished); })'),
        }).problems,
      ).toEqual([]);
    });
  });

  describe('the callbacks of a gesture', () => {
    const place = { 'ui/place.ts': 'export function place(x: number) { return x; }' };
    const placeWorklet = {
      'ui/place.ts': "export function place(x: number) { 'worklet'; return x; }",
    };
    const pan = (chain: string) => `import { place } from './place';
export function pan() {
  return ${chain};
}`;

    it.each(['onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize'])('%s', (name) => {
      const chain = `Gesture.Pan().${name}((event) => { place(event.x); })`;
      expect(fixture({ ...place, 'ui/pan.tsx': pan(chain) }).problems).toEqual([
        `ui/pan.tsx Gesture.Pan ${name} calls place (ui/place.ts), not a worklet`,
      ]);
      expect(fixture({ ...placeWorklet, 'ui/pan.tsx': pan(chain) }).problems).toEqual([]);
    });

    it('reads a chain written over several lines, every callback in it, and a callback by name', () => {
      const chain = `Gesture.Pan()
    .activeOffsetY(8)
    .onBegin(() => {
      place(0);
    })
    .onUpdate((event) => {
      place(event.translationX);
    })
    .onEnd(finish)`;
      const source = `${pan(chain)}
function finish() {
  return 1;
}`;
      expect(fixture({ ...place, 'ui/pan.tsx': source }).problems).toEqual([
        'ui/pan.tsx Gesture.Pan onBegin calls place (ui/place.ts), not a worklet',
        'ui/pan.tsx Gesture.Pan onUpdate calls place (ui/place.ts), not a worklet',
        'ui/pan.tsx Gesture.Pan onEnd calls finish (ui/pan.tsx), not a worklet',
      ]);
    });

    it('leaves alone a gesture that runs on the JavaScript thread, and what is not a gesture', () => {
      expect(
        fixture({
          ...place,
          'ui/pan.tsx': pan('Gesture.Tap().runOnJS(true).onEnd(() => { place(1); })'),
        }).problems,
      ).toEqual([]);
      expect(
        fixture({
          ...place,
          'ui/pan.tsx': pan('emitter.onChange(() => { place(1); })'),
        }).problems,
      ).toEqual([]);
      // Handing the work to the JavaScript thread is how a gesture reaches a plain function.
      expect(
        fixture({
          ...place,
          'ui/pan.tsx': pan('Gesture.Tap().onEnd((event) => { scheduleOnRN(place, event.x); })'),
        }).problems,
      ).toEqual([]);
    });
  });
});
