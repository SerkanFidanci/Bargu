import {
  type CheckinBox,
  type CheckinInbox,
  checkinInboxSchema,
  type CheckinList,
  checkinListSchema,
  type CheckinReply,
  checkinReplySchema,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** The server side of arrival checks (docs/ADR/0039 §5): it keeps sealed boxes, never reads them. */
export const checkinApi = {
  async create(id: string, openAt: number, boxes: CheckinBox[]): Promise<CheckinReply> {
    return checkinReplySchema.parse(
      await api.authed('/v1/checkins', { method: 'POST', body: { id, openAt, boxes } }),
    );
  },

  async refresh(id: string, boxes: CheckinBox[]): Promise<CheckinReply> {
    return checkinReplySchema.parse(
      await api.authed(`/v1/checkins/${id}/boxes`, { method: 'PUT', body: { boxes } }),
    );
  },

  async extend(id: string, openAt: number, boxes: CheckinBox[]): Promise<CheckinReply> {
    return checkinReplySchema.parse(
      await api.authed(`/v1/checkins/${id}/extend`, { method: 'POST', body: { openAt, boxes } }),
    );
  },

  async cancel(id: string): Promise<CheckinReply> {
    return checkinReplySchema.parse(await api.authed(`/v1/checkins/${id}`, { method: 'DELETE' }));
  },

  async list(): Promise<CheckinList> {
    return checkinListSchema.parse(await api.authed('/v1/checkins'));
  },

  async inbox(): Promise<CheckinInbox> {
    return checkinInboxSchema.parse(await api.authed('/v1/checkins/inbox'));
  },

  async ack(id: string): Promise<void> {
    await api.authed(`/v1/checkins/${id}/ack`, { method: 'POST' });
  },
};
