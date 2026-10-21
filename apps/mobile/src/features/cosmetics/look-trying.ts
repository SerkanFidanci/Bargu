import { create } from 'zustand';

import type { LookChoice } from './look-styles';

/**
 * Styles being tried from packs not bought (docs/ADR/0025 addendum): shown on the pin, never saved
 * or sent. Absent (undefined) is not trying; null is trying the plain one. Kept outside the screen
 * so that a style tried from a pack a parent has yet to say yes to is still there when the yes
 * arrives (look-approval.ts), whatever screen the user is on.
 */
export interface Trying {
  ring?: string | null | undefined;
  frame?: string | null | undefined;
}

export const useTrying = create<Trying>(() => ({}));

/** Tries a style (null: the plain one) of a part of the look. */
export function tryStyle(part: keyof LookChoice, id: string | null): void {
  useTrying.setState(part === 'ring' ? { ring: id } : { frame: id });
}

/** Stops trying a part of the look. */
export function stopTrying(part: keyof LookChoice): void {
  useTrying.setState(part === 'ring' ? { ring: undefined } : { frame: undefined });
}

/** Signed out: nothing is being tried. */
export function resetTrying(): void {
  useTrying.setState({ ring: undefined, frame: undefined });
}
