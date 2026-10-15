import {
  type GuardianCode,
  guardianCodeSchema,
  type GuardianEnd,
  guardianEndSchema,
  type GuardianLink,
  guardianLinkSchema,
  guardianLinksSchema,
  type GuardianPreview,
  guardianPreviewSchema,
  type GuardianView,
  guardianViewSchema,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** The user's guardian links (docs/ADR/0023 §4); `guardians.changed` refetches them. */
export const guardiansKey = ['guardians'] as const;
export const guardianViewKey = (linkId: string) => ['guardians', 'view', linkId] as const;

export const guardiansApi = {
  async list(): Promise<GuardianLink[]> {
    return guardianLinksSchema.parse(await api.authed('/v1/guardians')).links;
  },
  /** The child's code for a parent to take (10 minutes, once). */
  async code(): Promise<GuardianCode> {
    return guardianCodeSchema.parse(await api.authed('/v1/guardians/code', { method: 'POST' }));
  },
  async preview(token: string): Promise<GuardianPreview> {
    return guardianPreviewSchema.parse(
      await api.authed('/v1/guardians/preview', {
        method: 'POST',
        body: { token },
        idempotent: true,
      }),
    );
  },
  /** The parent's yes; the child says the last one. */
  async accept(token: string): Promise<GuardianLink> {
    return guardianLinkSchema.parse(
      await api.authed('/v1/guardians/accept', { method: 'POST', body: { token } }),
    );
  },
  async confirm(linkId: string): Promise<GuardianLink> {
    return guardianLinkSchema.parse(
      await api.authed(`/v1/guardians/${linkId}/confirm`, { method: 'POST' }),
    );
  },
  async end(linkId: string): Promise<GuardianEnd> {
    return guardianEndSchema.parse(
      await api.authed(`/v1/guardians/${linkId}/end`, { method: 'POST' }),
    );
  },
  async view(linkId: string): Promise<GuardianView> {
    return guardianViewSchema.parse(await api.authed(`/v1/guardians/${linkId}`));
  },
};
