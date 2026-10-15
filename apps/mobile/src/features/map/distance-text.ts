/** A distance as people read it: "850 m", "4,2 km", "37 km". */
export function distanceText(metres: number, language: string): string {
  const format = new Intl.NumberFormat(language, {
    maximumFractionDigits: metres < 10_000 ? 1 : 0,
  });
  return metres < 1_000 ? `${String(Math.round(metres))} m` : `${format.format(metres / 1_000)} km`;
}
