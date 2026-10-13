import {
  type Circle,
  circleSchema,
  circlesSchema,
  type GROUP_KINDS,
  type Invite,
  inviteAcceptedSchema,
  type InvitePreview,
  invitePreviewSchema,
  inviteSchema,
  keyEnvelopesSchema,
  type PublicProfile,
  publicProfileSchema,
  type SenderKeyDistribution,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** Thin, validated calls for circles, friends, invites and keys (apps/api circles.controller). */
export const circlesApi = {
  async list(): Promise<Circle[]> {
    return circlesSchema.parse(await api.authed('/v1/circles')).circles;
  },
  async get(id: string): Promise<Circle> {
    return circleSchema.parse(await api.authed(`/v1/circles/${id}`));
  },
  async create(kind: (typeof GROUP_KINDS)[number], name: string): Promise<Circle> {
    return circleSchema.parse(
      await api.authed('/v1/circles', { method: 'POST', body: { kind, name } }),
    );
  },
  async rename(id: string, name: string): Promise<Circle> {
    return circleSchema.parse(
      await api.authed(`/v1/circles/${id}`, { method: 'PATCH', body: { name } }),
    );
  },
  async accept(id: string): Promise<Circle> {
    return circleSchema.parse(await api.authed(`/v1/circles/${id}/accept`, { method: 'POST' }));
  },
  async decline(id: string): Promise<void> {
    await api.authed(`/v1/circles/${id}/decline`, { method: 'POST' });
  },
  async leave(id: string): Promise<void> {
    await api.authed(`/v1/circles/${id}/leave`, { method: 'POST' });
  },
  async rekey(id: string): Promise<Circle> {
    return circleSchema.parse(await api.authed(`/v1/circles/${id}/rekey`, { method: 'POST' }));
  },
  async invite(id: string, username: string): Promise<Circle> {
    return circleSchema.parse(
      await api.authed(`/v1/circles/${id}/members`, { method: 'POST', body: { username } }),
    );
  },
  async remove(id: string, userId: string): Promise<Circle> {
    return circleSchema.parse(
      await api.authed(`/v1/circles/${id}/members/${userId}/remove`, { method: 'POST' }),
    );
  },
  async requestFriend(username: string): Promise<Circle> {
    return circleSchema.parse(
      await api.authed('/v1/friends', { method: 'POST', body: { username } }),
    );
  },
  async profile(username: string): Promise<PublicProfile> {
    return publicProfileSchema.parse(
      await api.authed(`/v1/profiles?username=${encodeURIComponent(username)}`),
    );
  },
  async createInvite(
    input: { kind: 'friend' } | { kind: 'circle'; circleId: string },
  ): Promise<Invite> {
    return inviteSchema.parse(await api.authed('/v1/invites', { method: 'POST', body: input }));
  },
  async previewInvite(token: string): Promise<InvitePreview> {
    return invitePreviewSchema.parse(
      await api.authed('/v1/invites/preview', { method: 'POST', body: { token } }),
    );
  },
  async acceptInvite(token: string): Promise<string> {
    return inviteAcceptedSchema.parse(
      await api.authed('/v1/invites/accept', { method: 'POST', body: { token } }),
    ).circleId;
  },
  async uploadKeys(
    id: string,
    epoch: number,
    distributions: SenderKeyDistribution[],
  ): Promise<void> {
    await api.authed(`/v1/circles/${id}/keys`, { method: 'POST', body: { epoch, distributions } });
  },
  async keys(id: string): Promise<SenderKeyDistribution[]> {
    return keyEnvelopesSchema.parse(await api.authed(`/v1/circles/${id}/keys`)).distributions;
  },
};
