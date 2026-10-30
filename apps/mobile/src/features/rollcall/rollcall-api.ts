import {
  type ChatEnvelope,
  type DevicePushes,
  rollcallReplySchema,
  type RollcallSetting,
  rollcallSettingSchema,
  type RollcallView,
  rollcallViewSchema,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** The server side of event roll calls (docs/ADR/0040). */
export const rollcallApi = {
  async start(circleId: string, envelope: ChatEnvelope, pushes: DevicePushes) {
    const reply = await api.authed(`/v1/circles/${circleId}/rollcalls`, {
      method: 'POST',
      body: { envelope, pushes },
    });
    return rollcallReplySchema.parse(reply);
  },

  async answer(circleId: string, rollcallId: string, envelope: ChatEnvelope) {
    const reply = await api.authed(`/v1/circles/${circleId}/rollcalls/${rollcallId}/answer`, {
      method: 'POST',
      body: { envelope },
    });
    return rollcallReplySchema.parse(reply);
  },

  async close(circleId: string, rollcallId: string) {
    const reply = await api.authed(`/v1/circles/${circleId}/rollcalls/${rollcallId}/close`, {
      method: 'POST',
    });
    return rollcallReplySchema.parse(reply);
  },

  async current(circleId: string): Promise<RollcallView> {
    return rollcallViewSchema.parse(await api.authed(`/v1/circles/${circleId}/rollcalls/current`));
  },

  async setting(): Promise<RollcallSetting> {
    return rollcallSettingSchema.parse(await api.authed('/v1/me/rollcalls'));
  },

  async setSetting(on: boolean): Promise<RollcallSetting> {
    return rollcallSettingSchema.parse(
      await api.authed('/v1/me/rollcalls', { method: 'PUT', body: { on } }),
    );
  },
};
