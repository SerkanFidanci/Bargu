import {
  anyoneSees,
  lastReview,
  reminderAt,
  reminderDue,
  reminderSummary,
  saveReview,
  SHARING_REMINDER_EVERY_MS,
  useSharingReminder,
} from './sharing-reminder';
import { circleOf, memoryStore, somebody } from './test-support';

const NOW = 1_000_000_000;

describe('the weekly "who sees you" reminder (Faz 9)', () => {
  it('is due a week after the last look, never before the first look is counted', () => {
    expect(reminderDue(null, NOW)).toBe(false);
    expect(reminderDue(NOW, NOW + SHARING_REMINDER_EVERY_MS - 1)).toBe(false);
    expect(reminderDue(NOW, NOW + SHARING_REMINDER_EVERY_MS)).toBe(true);
    expect(reminderAt(NOW)).toBe(NOW + SHARING_REMINDER_EVERY_MS);
  });

  it('keeps the last look on the phone and tells the screen', () => {
    const store = memoryStore();
    expect(lastReview(store)).toBeNull();
    saveReview(store, NOW);
    expect(lastReview(store)).toBe(NOW);
    expect(useSharingReminder.getState().reviewedAt).toBe(NOW);
  });

  it('counts people once, circle by circle, and says nothing when nobody sees anything', () => {
    const [me, ada, bo] = [somebody(), somebody(), somebody()];
    const family = circleOf([me, ada, bo], { name: 'Aile' });
    const team = circleOf([me, ada], { name: 'Ekip' });
    const seers = (circle: typeof family) =>
      circle.members.filter((member) => member.userId !== me.userId);
    const summary = reminderSummary(
      [
        { circle: family, seers: seers(family) },
        { circle: team, seers: seers(team) },
      ],
      [{ viewers: seers(team) }],
      (circle) => circle.name ?? '',
    );
    expect(summary).toEqual({
      people: 2,
      circles: [
        { circleId: family.id, name: 'Aile', count: 2 },
        { circleId: team.id, name: 'Ekip', count: 1 },
      ],
      historyPeople: 1,
    });
    expect(anyoneSees(summary)).toBe(true);
    expect(anyoneSees(reminderSummary([], [], () => ''))).toBe(false);
  });
});
