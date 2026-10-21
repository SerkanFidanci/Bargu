import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Animations run as worklets on the UI thread (CLAUDE.md). A worklet that calls a plain function
 * of ours throws there on every frame; jest runs worklets on the JS thread, where the same call
 * works, so no render test sees it. bc5f925 shipped one (the activity drawing's rotation helper)
 * and froze the phone. This reads the source instead: every function of ours called from an
 * animation callback, or from another worklet, must itself be a worklet.
 */

const SRC = resolve(__dirname);
const CALLBACKS = /\b(useAnimatedStyle|useAnimatedProps|useDerivedValue|useFrameCallback)\(/g;

function sources(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
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

/** Local imports of a file: name → the file it comes from. */
function localImports(file: string, text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'((?:\.|@\/)[^']+)'/g)) {
    const [, names = '', from = ''] = match;
    const base = from.startsWith('@/') ? join(SRC, from.slice(2)) : resolve(dirname(file), from);
    const target = ['.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((ext) => base + ext)
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a module this app imports
      .find((candidate) => existsSync(candidate));
    if (target === undefined) continue;
    for (const part of names.split(',')) {
      const name = part
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      const original = part
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && original !== undefined && name !== '')
        found.set(name, `${target}#${original}`);
    }
  }
  return found;
}

/** Plain calls in a piece of code (not methods: Math.sin, phase.get). */
function calls(code: string): string[] {
  return [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1] ?? '');
}

describe('worklets call only worklets (the freeze of bc5f925)', () => {
  it('every function of ours that an animation calls on the UI thread is a worklet', () => {
    const problems: string[] = [];
    const texts = new Map<string, string>();
    const read = (file: string) => {
      const known = texts.get(file);
      if (known !== undefined) return known;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source files, found under src
      const text = readFileSync(file, 'utf8');
      texts.set(file, text);
      return text;
    };
    const checked = new Set<string>();
    const check = (file: string, code: string, where: string) => {
      const text = read(file);
      const own = definitions(text);
      const imported = localImports(file, text);
      for (const name of calls(code)) {
        let target: { file: string; body: string } | undefined;
        const body = own.get(name);
        if (body !== undefined) target = { file, body };
        const from = imported.get(name);
        if (target === undefined && from !== undefined) {
          const [path = '', original = ''] = from.split('#');
          const there = definitions(read(path)).get(original);
          if (there !== undefined) target = { file: path, body: there };
        }
        if (target === undefined) continue;
        // Components and hooks are not called from worklets; skip what looks like one.
        if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) continue;
        if (!/['"]worklet['"]/.test(target.body)) {
          problems.push(`${where} calls ${name} (${target.file.slice(SRC.length)}), not a worklet`);
          continue;
        }
        const key = `${target.file}#${name}`;
        if (checked.has(key)) continue;
        checked.add(key);
        check(target.file, target.body, name);
      }
    };
    for (const file of sources(SRC)) {
      const text = read(file);
      for (const match of text.matchAll(CALLBACKS)) {
        const open = match.index + match[0].length - 1;
        check(file, balanced(text, open), `${file.slice(SRC.length)} ${match[1] ?? ''}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
