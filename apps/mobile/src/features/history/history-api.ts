import { historySchema } from '@bargu/schemas';
import { create } from 'zustand';

import { api } from '../auth/auth-store';
import type { HistoryApi } from './history';

export const historyApi: HistoryApi = {
  put: async (circleId, slot, envelope) => {
    await api.authed(`/v1/circles/${circleId}/history/${String(slot)}`, {
      method: 'PUT',
      body: { envelope },
    });
  },
  list: async (circleId, userId, from, to) =>
    historySchema.parse(
      await api.authed(
        `/v1/circles/${circleId}/history/${userId}?from=${String(from)}&to=${String(to)}`,
      ),
    ).chunks,
  remove: async (circleId) => {
    await api.authed(`/v1/circles/${circleId}/history`, { method: 'DELETE' });
  },
};

/**
 * A new piece of someone's history came up (live message), per `${circleId}:${userId}`: an open
 * history screen fetches that member's day again.
 */
export const useHistoryPings = create<Record<string, number>>(() => ({}));
