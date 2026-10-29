/**
 * How a screen with a text field makes room for the keyboard, on both platforms. The app draws edge
 * to edge on Android, so the window no longer shrinks when the keyboard opens; with no behavior the
 * field stays under the keyboard and you cannot see what you type (the owner, 2026-10-30). Padding
 * is only the keyboard's overlap with the view: where a window does shrink it is zero, so nothing
 * is made room for twice. The padding replaces the view's own bottom padding, so the view itself
 * keeps none.
 */
export const KEYBOARD_BEHAVIOR = 'padding' as const;
