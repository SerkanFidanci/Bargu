import {
  blockListSchema,
  type ChatEnvelope,
  chatListSchema,
  type ChatRecord,
  type ChatSendReply,
  chatSendReplySchema,
  type DevicePushes,
  type DirectEnvelope,
  type ReportRequest,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** The server side of messages and moments (docs/ADR/0035 §6). */
export const messagesApi = {
  async toCircle(
    circleId: string,
    envelope: ChatEnvelope,
    pushes: DevicePushes,
    blobId?: string,
  ): Promise<ChatSendReply> {
    const reply = await api.authed(`/v1/chat/circles/${circleId}`, {
      method: 'POST',
      body: { envelope, pushes, ...(blobId === undefined ? {} : { blobId }) },
    });
    return chatSendReplySchema.parse(reply);
  },

  async toPerson(
    userId: string,
    envelope: DirectEnvelope,
    pushes: DevicePushes,
    blobId?: string,
  ): Promise<ChatSendReply> {
    const reply = await api.authed(`/v1/chat/people/${userId}`, {
      method: 'POST',
      body: { envelope, pushes, ...(blobId === undefined ? {} : { blobId }) },
    });
    return chatSendReplySchema.parse(reply);
  },

  /** Items the server took after `after` (its own time), oldest first. */
  async since(after: number): Promise<ChatRecord[]> {
    const reply = await api.authed(`/v1/chat?after=${String(Math.max(0, Math.floor(after)))}`);
    return chatListSchema.parse(reply).items;
  },

  async remove(itemId: string): Promise<void> {
    await api.authed(`/v1/chat/${itemId}`, { method: 'DELETE' });
  },

  async blocked(): Promise<string[]> {
    return blockListSchema.parse(await api.authed('/v1/blocks')).blocked;
  },

  async block(userId: string): Promise<void> {
    await api.authed(`/v1/blocks/${userId}`, { method: 'PUT' });
  },

  async unblock(userId: string): Promise<void> {
    await api.authed(`/v1/blocks/${userId}`, { method: 'DELETE' });
  },

  async report(request: ReportRequest): Promise<void> {
    await api.authed('/v1/reports', { method: 'POST', body: request });
  },
};
