import { type DeviceKeys, randomUuid } from '@bargu/crypto';
import type { Circle, Session } from '@bargu/schemas';
import type { Response } from 'light-my-request';

import type { TestApp } from './app.js';
import { call, login, uniqueEmail } from './client.js';

/** A signed-in person with a username and a name, as after onboarding. */
export interface Person {
  email: string;
  session: Session;
  device: DeviceKeys;
  userId: string;
  username: string;
}

export async function person(test: TestApp, name = 'Test'): Promise<Person> {
  const email = uniqueEmail();
  const { session, device } = await login(test, email);
  const username = `p${randomUuid().replaceAll('-', '').slice(-12)}`;
  const response = await call(test.app, {
    method: 'PATCH',
    url: '/v1/me',
    body: { username, displayName: name },
    accessToken: session.accessToken,
    device,
  });
  if (response.statusCode !== 200) throw new Error(`profile: ${response.body}`);
  return { email, session, device, userId: session.userId, username };
}

/** A signed (for mutations) and authenticated request as `who`. */
export function as(
  test: TestApp,
  who: Person,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  body?: unknown,
): Promise<Response> {
  return call(test.app, {
    method,
    url,
    accessToken: who.session.accessToken,
    ...(method === 'GET' ? {} : { device: who.device }),
    ...(body === undefined ? {} : { body }),
  });
}

export async function createCircle(test: TestApp, owner: Person, name = 'Aile'): Promise<Circle> {
  const response = await as(test, owner, 'POST', '/v1/circles', { kind: 'family', name });
  if (response.statusCode !== 201) throw new Error(`create circle: ${response.body}`);
  return response.json<Circle>();
}

/** Puts `members` into the owner's circle through invitations they accept. */
export async function circleWith(
  test: TestApp,
  owner: Person,
  ...members: Person[]
): Promise<Circle> {
  const circle = await createCircle(test, owner);
  for (const member of members) {
    const invited = await as(test, owner, 'POST', `/v1/circles/${circle.id}/members`, {
      username: member.username,
    });
    if (invited.statusCode !== 200) throw new Error(`invite: ${invited.body}`);
    const accepted = await as(test, member, 'POST', `/v1/circles/${circle.id}/accept`);
    if (accepted.statusCode !== 200) throw new Error(`accept: ${accepted.body}`);
  }
  const final = await as(test, owner, 'GET', `/v1/circles/${circle.id}`);
  return final.json<Circle>();
}
