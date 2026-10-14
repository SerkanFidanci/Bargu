import { z } from 'zod';

/**
 * Current weather over a fixed grid (BARGU_PLAN §4.3, docs/ADR/0013): the same file for everyone,
 * so a phone finds its own cell without telling anyone where it is.
 */
export const weatherSnapshotSchema = z
  .object({
    /** When it was measured (Unix ms). */
    at: z.number().int().nonnegative(),
    /** South-west corner and spacing in degrees; cells are row-major from there, rows going north. */
    grid: z
      .object({
        south: z.number().min(-90).max(90),
        west: z.number().min(-180).max(180),
        step: z.number().positive().max(10),
        rows: z.number().int().positive().max(200),
        cols: z.number().int().positive().max(400),
      })
      .strict(),
    /** [WMO weather code, daytime 0/1, °C, cloud cover %, precipitation mm, wind km/h], or null. */
    cells: z.array(
      z
        .tuple([
          z.number().int().min(0).max(99),
          z.number().int().min(0).max(1),
          z.number().min(-90).max(70),
          z.number().min(0).max(100),
          z.number().min(0).max(500),
          z.number().min(0).max(500),
        ])
        .nullable(),
    ),
  })
  .strict()
  .refine((snapshot) => snapshot.cells.length === snapshot.grid.rows * snapshot.grid.cols, {
    message: 'cells must fill the grid',
  });
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;

/** Live message: a new snapshot is available (the phone fetches it). */
export const weatherEventSchema = z.object({ at: z.number().int().nonnegative() }).strict();
