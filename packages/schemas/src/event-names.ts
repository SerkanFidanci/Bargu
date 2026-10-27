import { type ServerEvent, serverEventSchema } from './circles.js';

/**
 * Every name the server sends over the event socket (apps/api events.gateway), in one place. The
 * API can emit only these (EventsService.emitLive / emitAll take a `LiveEvent`), and the app's
 * contract test (apps/mobile features/events/event-contract.test.ts) fails when a name here is
 * neither listened to nor listed as deliberately ignored. So a new message cannot be forgotten on
 * the phone, as `place` and `history` were from Faz 7 until QA found it.
 *
 * The socket carries two kinds of message:
 *  - the durable stream, one socket name (`STREAM_EVENT`), kept 24 hours so a phone that was
 *    offline can resume (`SERVER_EVENT_TYPES` below tells them apart);
 *  - live messages, one socket name each, listed here: pushed at once, never stored, the phone
 *    catches up by asking for a snapshot.
 */

/** The socket name every durable stream event travels under; its `type` says which it is. */
export const STREAM_EVENT = 'event';

/**
 * Live messages. A `.gone` name says the member's latest message of that kind is no longer on the
 * server in that circle (they left, were removed, or took it back).
 */
export const LIVE_EVENTS = [
  // A member's latest location, and its removal.
  'loc',
  'loc.gone',
  // Their status (emoji and text), and its removal.
  'status',
  'status.gone',
  // Their profile (the photo key, docs/ADR/0014), and its removal.
  'profile',
  'profile.gone',
  // Their look on the map (docs/ADR/0025), and its removal.
  'look',
  'look.gone',
  // Why their location is old ("Neden eski?", docs/ADR/0028), and its removal.
  'state',
  'state.gone',
  // A poke.
  'bump',
  // "Güvendeyim" (docs/ADR/0029).
  'safe',
  // Arrivals, departures, "geç kalıyorum", "Geldim" (docs/ADR/0016, 0026).
  'place',
  // Someone looks at a circle on the map: live updates for a while.
  'watch',
  // A friend's new quarter hour of history (docs/ADR/0019).
  'history',
  // A new weather snapshot, the same for everyone (docs/ADR/0013).
  'weather',
  // Messages and moments (docs/ADR/0035): a new item, and one taken back.
  'chat',
  'chat.gone',
] as const;
export type LiveEvent = (typeof LIVE_EVENTS)[number];

/** The `type` of every durable stream event, read from the schema so the two cannot differ. */
export type ServerEventType = ServerEvent['type'];
export const SERVER_EVENT_TYPES: readonly ServerEventType[] = serverEventSchema.options.map(
  (option) => option.shape.type.value,
);
