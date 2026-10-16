import { CAPSULE_MAX, capsuleOf, clusterPeople, worldPx } from './cluster';
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

  it('puts the user in with the others, so no avatar sits on top of another (2026-10-16)', () => {
    const people = [person('me', 0), person('ayse', 3), person('far', 2_000)];
    expect(clusterPeople(people, 19).map((cluster) => cluster.key)).toEqual(['ayse+me', 'far']);
  });

  it('gives the same groups whatever order people come in', () => {
    const people = [person('x', 0), person('y', 10), person('z', 20)];
    const forward = clusterPeople(people, 14).map((cluster) => cluster.key);
    const backward = clusterPeople([...people].reverse(), 14).map((cluster) => cluster.key);
    expect(backward).toEqual(forward);
  });
});

describe('a capsule of people together', () => {
  const ids = (capsule: ReturnType<typeof capsuleOf<{ id: string }>>) =>
    capsule.shown.map(({ member }) => member.id);

  it('shows everyone side by side, the user last', () => {
    const capsule = capsuleOf([{ id: 'ayse' }, { id: 'me' }, { id: 'cem' }], 'me');
    expect(ids(capsule)).toEqual(['ayse', 'cem', 'me']);
    expect(capsule.more).toBe(0);
    // Each keeps its place in the cluster (where it flows in from).
    expect(capsule.shown.map(({ index }) => index)).toEqual([0, 2, 1]);
    expect(capsuleOf([{ id: 'ayse' }, { id: 'cem' }], 'me').more).toBe(0);
  });

  it('counts the rest past the limit, and never hides the user', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'me'].map((id) => ({ id }));
    const capsule = capsuleOf(many, 'me');
    expect(ids(capsule)).toEqual(['a', 'b', 'me']);
    expect(capsule.shown.length + 1).toBe(CAPSULE_MAX);
    expect(capsule.more).toBe(3);
    const withoutMe = capsuleOf(many.slice(0, 5), 'me');
    expect(ids(withoutMe)).toEqual(['a', 'b', 'c']);
    expect(withoutMe.more).toBe(2);
    // Exactly the limit: all of them, no count.
    expect(capsuleOf(many.slice(0, CAPSULE_MAX), null).more).toBe(0);
  });
});
