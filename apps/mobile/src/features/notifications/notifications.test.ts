import { randomUuid, sealPush } from '@bargu/crypto';

import i18n from '@/i18n';

import { circleOf, exchangeKeys, nth, somebody } from '../location/test-support';
import { sealedOf } from './push-payload';
import { isMuted, NO_MUTES, withPersonMuted, withPlaceMuted } from './mutes';
import { contactsOf, identityOf } from './push-contacts';
import { pushText } from './push-text';

const placeId = '0190f7a4-2222-7222-8222-000000000001';

describe('who may notify this phone', () => {
  it('only trusted, active members, under the name this phone knows', () => {
    const [me, ada, newcomer] = [somebody(), somebody(), somebody()];
    const circle = circleOf([me, ada]);
    exchangeKeys(circle, [me, ada]);
    // Newcomer is in the circle but no key was ever exchanged with them: not trusted.
    const withNewcomer = {
      ...circle,
      members: [...circle.members, nth(circleOf([newcomer]).members)],
    };
    const contacts = contactsOf([withNewcomer], me.keys, me.userId);
    expect(Object.keys(contacts.devices)).toEqual([ada.device.deviceId]);
    expect(identityOf(contacts, ada.device.deviceId)).toEqual(ada.device.identity.publicKey);
    expect(identityOf(contacts, newcomer.device.deviceId)).toBeNull();
    expect(contacts.recipients[circle.id]?.map((r) => r.userId)).toEqual([ada.userId]);
  });
});

describe('notification texts', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('tr');
  });
  const [me, ada] = [somebody(), somebody()];
  const circle = circleOf([me, ada], { name: 'Aile' });
  exchangeKeys(circle, [me, ada]);
  const contacts = contactsOf([circle], me.keys, me.userId);

  it('name the member as this phone knows them, and the place they sent', () => {
    const body = {
      kind: 'place',
      circleId: circle.id,
      placeId,
      event: 'enter',
      name: 'Ev',
      emoji: '🏠',
      ts: 1,
    } as const;
    expect(pushText(body, ada.device.deviceId, contacts)).toMatchObject({
      title: '🏠 Ev',
      body: 'Test vardı',
      channel: 'places',
      fromUserId: ada.userId,
    });
    expect(pushText({ ...body, event: 'exit' }, ada.device.deviceId, contacts)?.body).toBe(
      'Test ayrıldı',
    );
    expect(
      pushText({ kind: 'bump', circleId: circle.id, ts: 1 }, ada.device.deviceId, contacts),
    ).toMatchObject({ body: 'Test seni dürttü 👋', channel: 'social' });
    // An unknown device gets no notification at all.
    expect(pushText(body, me.device.deviceId, contacts)).toBeNull();
  });

  it('word a meeting started in the circle: who, when and where (docs/ADR/0026 §6)', () => {
    const meetAt = new Date(2026, 9, 16, 17, 30).getTime();
    const shown = pushText(
      { kind: 'meeting', circleId: circle.id, name: 'Ev', emoji: '🏠', meetAt, ts: 1 },
      ada.device.deviceId,
      contacts,
    );
    expect(shown).toMatchObject({ channel: 'meetings', fromUserId: ada.userId });
    expect(shown?.body).toMatch(/^Test buluşma başlattı: 17[:.]30 · 🏠 Ev$/);
  });

  it('word an answer to a meeting for its starter, and a moved meeting (docs/ADR/0026 Ek 2)', () => {
    const answered = pushText(
      { kind: 'meetingAnswer', circleId: circle.id, answer: 1, going: 3, maybe: 1, ts: 1 },
      ada.device.deviceId,
      contacts,
    );
    expect(answered).toMatchObject({ channel: 'meetings', fromUserId: ada.userId });
    expect(answered?.body).toBe('Test: Belki · 3 geliyor, 1 belki');
    const meetAt = new Date(2026, 9, 16, 18, 30).getTime();
    const moved = pushText(
      { kind: 'meetingMoved', circleId: circle.id, name: 'Ev', emoji: '🏠', meetAt, ts: 1 },
      ada.device.deviceId,
      contacts,
    );
    expect(moved).toMatchObject({ channel: 'meetings', fromUserId: ada.userId });
    expect(moved?.body.startsWith('Test buluşmayı değiştirdi: 🏠 Ev, 18')).toBe(true);
    expect(moved?.body.endsWith('30. Hâlâ geliyor musun?')).toBe(true);
  });

  it("word the server's notices themselves, with the circle's name when known", () => {
    expect(
      pushText(
        { kind: 'notice', notice: 'memberJoined', circleId: circle.id, ts: 1 },
        null,
        contacts,
      )?.body,
    ).toBe('Aile çemberine yeni biri katıldı');
    expect(
      pushText({ kind: 'notice', notice: 'circleInvite', circleId: placeId, ts: 1 }, null, contacts)
        ?.body,
    ).toBe('Bir çembere davet edildin');
  });

  it('open the guardian screen for guardian notices, which name a link (docs/ADR/0023)', () => {
    const shown = pushText(
      { kind: 'notice', notice: 'guardianRequest', circleId: placeId, ts: 1 },
      null,
      contacts,
    );
    expect(shown).toMatchObject({
      body: 'Biri ebeveynin olmak istiyor; son onayı sen ver',
      route: 'guardians',
    });
    expect(
      pushText({ kind: 'notice', notice: 'friendAdded', circleId: placeId, ts: 1 }, null, contacts)
        ?.route,
    ).toBeUndefined();
    // A child asks for a look pack (docs/ADR/0025 §6): worded apart from Bargu+, same screen.
    expect(
      pushText(
        { kind: 'notice', notice: 'guardianCosmetic', circleId: placeId, ts: 1 },
        null,
        contacts,
      ),
    ).toMatchObject({
      body: 'Çocuğun bir süs paketi almak istiyor; onayını bekliyor',
      route: 'guardians',
    });
    // Someone new near the child: a parent's phone names the child after the link (QA 5c F-2).
    const linkId = randomUuid();
    const parents = contactsOf([circle], me.keys, me.userId, [
      {
        id: linkId,
        role: 'guardian',
        status: 'active',
        other: { username: 'deniz', displayName: 'Deniz', avatar: null },
        createdAt: 1,
        activeAt: 2,
        endRequestedAt: null,
        endsAt: null,
      },
    ]);
    const newMember = {
      kind: 'notice',
      notice: 'guardianNewMember',
      circleId: linkId,
      ts: 1,
    } as const;
    expect(pushText(newMember, null, parents)).toMatchObject({
      body: 'Deniz: bir çemberine yeni biri katıldı',
      route: 'guardians',
    });
    expect(pushText(newMember, null, contacts)?.body).toBe(
      'Çocuğunun bir çemberine yeni biri katıldı',
    );
  });

  it('warn that a newcomer will see the location, its history, or both (Faz 9, G2)', () => {
    const joined = { kind: 'notice', notice: 'memberJoined', circleId: circle.id, ts: 1 } as const;
    const seen = (location: boolean, history: boolean) => (circleId: string) => ({
      location: circleId === circle.id && location,
      history: circleId === circle.id && history,
    });
    expect(pushText(joined, null, contacts, seen(false, true))?.body).toBe(
      'Aile çemberine yeni biri katıldı; artık o da konum geçmişini görebilir',
    );
    expect(pushText(joined, null, contacts, seen(true, false))?.body).toBe(
      'Aile çemberine yeni biri katıldı; artık o da konumunu görebilir',
    );
    expect(pushText(joined, null, contacts, seen(true, true))?.body).toBe(
      'Aile çemberine yeni biri katıldı; artık o da konumunu ve konum geçmişini görebilir',
    );
    expect(pushText(joined, null, contacts, seen(false, false))?.body).toBe(
      'Aile çemberine yeni biri katıldı',
    );
    // An unknown circle (no name): the same, without its name.
    const elsewhere = { ...joined, circleId: placeId };
    expect(
      pushText(elsewhere, null, contacts, () => ({ location: true, history: false }))?.body,
    ).toBe('Çemberine yeni biri katıldı; artık o da konumunu görebilir');
  });
});

describe('muting', () => {
  it('silences a person’s arrivals or pokes, or a place for everyone', () => {
    const place = { kind: 'place', placeId } as const;
    let mutes = withPersonMuted(NO_MUTES, 'ada', { pokes: true });
    expect(isMuted(mutes, { kind: 'bump' }, 'ada')).toBe(true);
    expect(isMuted(mutes, place, 'ada')).toBe(false);
    mutes = withPlaceMuted(mutes, placeId, true);
    expect(isMuted(mutes, place, 'bora')).toBe(true);
    mutes = withPlaceMuted(withPersonMuted(mutes, 'ada', { pokes: false }), placeId, false);
    expect(mutes).toEqual(NO_MUTES);
  });
});

describe('data messages', () => {
  it('carry the sealed box under its own key, nothing else is taken', () => {
    const ada = somebody();
    const sealed = sealPush({
      recipient: { deviceId: ada.device.deviceId, dhKey: ada.device.dh.publicKey },
      sender: null,
      body: { kind: 'notice', notice: 'friendAdded', circleId: placeId, ts: 1 },
    });
    expect(sealedOf({ data: { bargu: sealed, dataString: null } })).toBe(sealed);
    expect(sealedOf({ bargu: sealed })).toBe(sealed);
    expect(sealedOf({ data: { title: 'x' } })).toBeNull();
    expect(sealedOf(null)).toBeNull();
  });
});
