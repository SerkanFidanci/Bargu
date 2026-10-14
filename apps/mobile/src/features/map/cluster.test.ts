import { clusterPeople, worldPx } from './cluster';
import { project } from './glide';

const GALATA = { lat: 41.0256, lng: 28.9742 };
const person = (id: string, metresEast: number) => ({ id, ...project(GALATA, 90, metresEast) });

describe('clusters', () => {
  it('measures distances on screen: twice the zoom, twice the pixels', () => {
    const a = worldPx(GALATA.lat, GALATA.lng, 14);
    const b = worldPx(GALATA.lat, GALATA.lng + 0.01, 14);
    const c = worldPx(GALATA.lat, GALATA.lng + 0.01, 15);
    const d = worldPx(GALATA.lat, GALATA.lng, 15);
    expect(c.x - d.x).toBeCloseTo((b.x - a.x) * 2, 5);
  });

  it('merges people who would overlap, and separates them when zoomed in', () => {
    const people = [person('b', 0), person('a', 30), person('c', 2_000)];
    const far = clusterPeople(people, 13);
    expect(far.map((cluster) => cluster.key)).toEqual(['a+b', 'c']);
    const merged = far[0];
    expect(merged?.offsets.reduce((sum, offset) => sum + offset.x, 0)).toBeCloseTo(0, 5);
    expect(clusterPeople(people, 19).map((cluster) => cluster.key)).toEqual(['a', 'b', 'c']);
  });

  it('gives the same groups whatever order people come in', () => {
    const people = [person('x', 0), person('y', 10), person('z', 20)];
    const forward = clusterPeople(people, 14).map((cluster) => cluster.key);
    const backward = clusterPeople([...people].reverse(), 14).map((cluster) => cluster.key);
    expect(backward).toEqual(forward);
  });
});
