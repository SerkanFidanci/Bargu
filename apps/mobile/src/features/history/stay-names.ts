/** A stay of the timeline, by when it began (unique within a day) and where it was. */
export interface StayPoint {
  from: number;
  lat: number;
  lng: number;
}

/** The fuller of two names of one place: "Caferağa, Kadıköy" over "Kadıköy", never none. */
export function fuller(known: string | undefined, found: string | null): string | undefined {
  if (found === null) return known;
  if (known === undefined) return found;
  return found.split(', ').length > known.split(', ').length ? found : known;
}

/**
 * Names for the stays of a day that are not in one of the circle's places (the owner, 2026-10-28:
 * "Bir yerde" said nothing). Each comes from the labels the map has drawn around it, on the phone
 * (docs/ADR/0013; never sent anywhere), so it is asked again each time the map settles: a closer
 * look names more, and a name already found is only ever made fuller.
 */
export async function nameStays(
  stays: readonly StayPoint[],
  known: Readonly<Record<number, string>>,
  lookup: (stay: StayPoint) => Promise<string | null>,
): Promise<Record<number, string>> {
  const found = await Promise.all(stays.map((stay) => lookup(stay).catch(() => null)));
  const names: Record<number, string> = { ...known };
  stays.forEach((stay, index) => {
    const name = fuller(names[stay.from], found[index] ?? null);
    if (name !== undefined) names[stay.from] = name;
  });
  return names;
}
