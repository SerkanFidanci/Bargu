import { create } from 'zustand';

/** The map's sheets that open screens of their own. */
export type ReturnSheet = 'me' | 'circles';

/**
 * Coming back from a screen opened from a sheet (UX düzeni 8, the owner: everything in its own
 * screen): the sheet opens again, scrolled where it was. The sheet closes before the screen opens
 * (a sheet would stay over it), so the map screen reopens it when it is shown again.
 */
export const useSheetReturn = create<{
  pending: ReturnSheet | null;
  scroll: Partial<Record<ReturnSheet, number>>;
}>(() => ({ pending: null, scroll: {} }));

/** This sheet is left for a screen: open it again on the way back. */
export function leaveSheet(sheet: ReturnSheet): void {
  useSheetReturn.setState({ pending: sheet });
}

/** The sheet to open again now that the map is shown, if any (once). */
export function takeReturn(): ReturnSheet | null {
  const { pending } = useSheetReturn.getState();
  if (pending !== null) useSheetReturn.setState({ pending: null });
  return pending;
}

/** Where a sheet was scrolled to, kept for its next opening. */
export function rememberScroll(sheet: ReturnSheet, y: number): void {
  useSheetReturn.setState((state) => ({ scroll: { ...state.scroll, [sheet]: y } }));
}
