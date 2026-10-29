import {
  fit,
  inkOn,
  isEdited,
  NO_EDIT,
  type Overlay,
  STICKERS,
  withOverlay,
  withoutLastStroke,
  withoutOverlay,
  withPlaced,
  withStroke,
} from './edit-model';
import { FILTERS, filterMatrix, nextFilter } from './filters';

const words: Overlay = {
  id: 'o1',
  kind: 'text',
  text: 'merhaba',
  color: '#FFFFFF',
  boxed: false,
  x: 100,
  y: 200,
  scale: 1,
  rotation: 0,
};

describe('the story editor, its model (docs/ADR/0035 Ek 3)', () => {
  it('fits the photo whole in the screen, centred', () => {
    const shown = fit({ w: 1200, h: 1600 }, { width: 400, height: 800 });
    expect(shown.width).toBe(400);
    expect(shown.left).toBe(0);
    expect(shown.height).toBeCloseTo(1600 / 3);
    expect(shown.top).toBeCloseTo((800 - 1600 / 3) / 2);
    expect(fit({ w: 1600, h: 1200 }, { width: 400, height: 200 }).height).toBe(200);
  });

  it('adds, moves (to the front), and takes away words; draws and undoes lines', () => {
    const sticker: Overlay = { ...words, id: 'o2', kind: 'sticker', text: '🔥' };
    let edit = withOverlay(withOverlay(NO_EDIT, words), sticker);
    edit = withPlaced(edit, 'o1', { x: 10, y: 20, scale: 2, rotation: 1 });
    expect(edit.overlays.map((each) => each.id)).toEqual(['o2', 'o1']);
    expect(edit.overlays[1]).toMatchObject({ x: 10, y: 20, scale: 2, rotation: 1 });
    expect(withoutOverlay(edit, 'o2').overlays.map((each) => each.id)).toEqual(['o1']);
    const lined = withStroke(
      withStroke(NO_EDIT, { path: 'M0 0L1 1', color: '#000000', width: 8 }),
      {
        path: 'M2 2L3 3',
        color: '#FFFFFF',
        width: 4,
      },
    );
    expect(withoutLastStroke(lined).strokes.map((stroke) => stroke.path)).toEqual(['M0 0L1 1']);
  });

  it('knows an untouched photo, which goes as it was taken', () => {
    expect(isEdited(NO_EDIT)).toBe(false);
    expect(isEdited({ ...NO_EDIT, filter: 'mono' })).toBe(true);
    expect(isEdited(withOverlay(NO_EDIT, words))).toBe(true);
  });

  it('writes black on a light box and white on a dark one', () => {
    expect(inkOn('#FFFFFF')).toBe('#000000');
    expect(inkOn('#F5D90A')).toBe('#000000');
    expect(inkOn('#000000')).toBe('#FFFFFF');
    expect(inkOn('#0A84FF')).toBe('#FFFFFF');
  });

  it('has no sticker that tells where a photo was taken', () => {
    expect(STICKERS).not.toContain('📍');
    expect(new Set(STICKERS).size).toBe(STICKERS.length);
  });
});

describe('the filters', () => {
  it('goes round them both ways, the photo as it is first', () => {
    expect(FILTERS[0]).toBe('none');
    expect(nextFilter('none', 1)).toBe('warm');
    expect(nextFilter('none', -1)).toBe('fade');
    expect(nextFilter('fade', 1)).toBe('none');
  });

  it('is a 4×5 colour matrix each, alpha untouched, none for the photo as it is', () => {
    expect(filterMatrix('none')).toBeNull();
    for (const key of FILTERS.filter((each) => each !== 'none')) {
      const matrix = filterMatrix(key) ?? [];
      expect(matrix).toHaveLength(20);
      expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
    // Black and white: every row the same grey.
    const mono = filterMatrix('mono') ?? [];
    expect(mono.slice(0, 5)).toEqual(mono.slice(5, 10));
  });
});
