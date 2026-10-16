import { z } from 'zod';

import { PLATFORMS } from './auth.js';
import { deviceKeyBundleSchema, senderKeyDistributionSchema } from './envelope.js';
import { avatarSchema, displayNameSchema, usernameSchema } from './profile.js';

/** Everything is a circle; a 1:1 friendship is a `pair` (BARGU_PLAN §1). */
export const CIRCLE_KINDS = ['pair', 'friends', 'family', 'event'] as const;
export const GROUP_KINDS = ['friends', 'family'] as const;
export const MEMBER_ROLES = ['owner', 'member'] as const;
export const MEMBER_STATUSES = ['invited', 'active'] as const;

/** Sender keys suit circles of up to 50 people (BARGU_PLAN §1); invitations count. */
export const MAX_CIRCLE_MEMBERS = 50;

/** Circle names follow the display-name rules (visible to invitees before they join). */
export const circleNameSchema = displayNameSchema;

/**
 * An event circle (BARGU_PLAN Faz 8) lasts from a quarter of an hour to a week; when it ends, the
 * server deletes it and everything in it, and the phones throw its keys away (docs/ADR/0017).
 */
export const EVENT_DURATION_MS = { min: 15 * 60_000, max: 7 * 24 * 3600_000 } as const;

export const circleCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('friends'), name: circleNameSchema }).strict(),
  z.object({ kind: z.literal('family'), name: circleNameSchema }).strict(),
  z
    .object({
      kind: z.literal('event'),
      name: circleNameSchema,
      /** When it ends (Unix ms); checked against EVENT_DURATION_MS on the server. */
      endsAt: z.number().int().positive(),
    })
    .strict(),
]);
export type CircleCreate = z.infer<typeof circleCreateSchema>;

export const circleRenameSchema = z.object({ name: circleNameSchema }).strict();

export const publicProfileSchema = z
  .object({
    username: z.string(),
    displayName: z.string().nullable(),
    avatar: avatarSchema.nullable(),
  })
  .strict();
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/**
 * A member as other members see them: profile, and the active device's keys once they joined.
 * Responses are read leniently: a field a newer server adds is dropped, not a failure (old apps
 * kept working when ADR 0024 added `paused`). Requests stay strict.
 */
export const memberCardSchema = z.object({
  userId: z.uuid(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatar: avatarSchema.nullable(),
  /** The key bundle exactly as signed by the device (verifyDeviceKeyBundle), and its platform. */
  device: z
    .object({ platform: z.enum(PLATFORMS), bundle: deviceKeyBundleSchema })
    .strict()
    .nullable(),
});
export type MemberCard = z.infer<typeof memberCardSchema>;

export const circleSchema = z.object({
  id: z.uuid(),
  kind: z.enum(CIRCLE_KINDS),
  name: z.string().nullable(),
  /** Current sender-key epoch and when it began (Unix ms); see PROTOCOL §4. */
  epoch: z.number().int().positive(),
  epochStartedAt: z.number().int(),
  myRole: z.enum(MEMBER_ROLES),
  myStatus: z.enum(MEMBER_STATUSES),
  members: z.array(memberCardSchema).max(MAX_CIRCLE_MEMBERS),
  /** Event circles only: when it began and when it ends and is deleted (Unix ms). */
  startedAt: z.number().int().optional(),
  expiresAt: z.number().int().optional(),
  /**
   * Nobody keeps it open: live location and history wait until someone has Bargu+ (ADR 0024).
   * Absent from servers before that: open.
   */
  paused: z.boolean().optional(),
});
export type Circle = z.infer<typeof circleSchema>;

export const circlesSchema = z.object({ circles: z.array(circleSchema) });

export const usernameBodySchema = z.object({ username: usernameSchema }).strict();
/** An admin makes a member admin (`owner`) or takes it back (`member`); docs/ADR/0020. */
export const memberRoleBodySchema = z.object({ role: z.enum(MEMBER_ROLES) }).strict();
export const profileQuerySchema = z.object({ username: z.string().max(64) }).strict();

/** Invite links and QR codes: opaque 256-bit tokens; only their hash is stored. */
export const inviteTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);

export const inviteCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('friend') }).strict(),
  z.object({ kind: z.literal('circle'), circleId: z.uuid() }).strict(),
]);
export type InviteCreate = z.infer<typeof inviteCreateSchema>;

export const inviteSchema = z
  .object({
    id: z.uuid(),
    token: inviteTokenSchema,
    /** What a QR code or shared link carries (opens the app). */
    link: z.string(),
    expiresAt: z.number().int(),
  })
  .strict();
export type Invite = z.infer<typeof inviteSchema>;

export const inviteTokenBodySchema = z.object({ token: inviteTokenSchema }).strict();

/** What someone holding a link sees before accepting. No ids, nothing about other members. */
export const invitePreviewSchema = z
  .object({
    kind: z.enum(['circle', 'friend']),
    inviter: publicProfileSchema,
    circle: z
      .object({
        name: z.string().nullable(),
        kind: z.enum(CIRCLE_KINDS),
        memberCount: z.number(),
        /** Event circles: when it ends (everything in it is deleted then). */
        expiresAt: z.number().int().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const inviteAcceptedSchema = z.object({ circleId: z.uuid() }).strict();

/** This device's sender key for the circle's current epoch, wrapped for each other member. */
export const keyUploadSchema = z
  .object({
    epoch: z.number().int().positive(),
    distributions: z
      .array(senderKeyDistributionSchema)
      .min(1)
      .max(MAX_CIRCLE_MEMBERS - 1),
  })
  .strict();
export type KeyUpload = z.infer<typeof keyUploadSchema>;

export const keyEnvelopesSchema = z
  .object({ distributions: z.array(senderKeyDistributionSchema) })
  .strict();

export const epochSchema = z
  .object({ epoch: z.number().int().positive(), epochStartedAt: z.number().int() })
  .strict();

/**
 * Server → app events over the WebSocket (BARGU_PLAN §3.4). Small on purpose: they say what
 * changed, and the app updates its cache (fetching that one circle when it needs the details).
 */
export const serverEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('circle.changed'),
      circleId: z.uuid(),
      epoch: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('circle.gone'), circleId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('keys.available'),
      circleId: z.uuid(),
      epoch: z.number().int().positive(),
    })
    .strict(),
  /** A place of the circle was saved or deleted: the app fetches that circle's places. */
  z.object({ type: z.literal('places.changed'), circleId: z.uuid() }).strict(),
  /** A document of the circle (plan, poll, vote) was saved or deleted: fetch that circle's. */
  z.object({ type: z.literal('docs.changed'), circleId: z.uuid() }).strict(),
  /**
   * Some circle of the user ended (an event circle the owner closed): reload the list. Names no
   * circle on purpose: nothing about an ended circle stays on the server (docs/ADR/0017).
   */
  z.object({ type: z.literal('circles.reload') }).strict(),
  /** A guardian link of the user changed (docs/ADR/0023 §4): fetch the links again. */
  z.object({ type: z.literal('guardians.changed') }).strict(),
  /** The user's own plan changed (bought, renewed, ran out; docs/ADR/0024): fetch it again. */
  z.object({ type: z.literal('plan.changed') }).strict(),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

/** An event as delivered: its stream id (for resume) and the time it happened. */
export const deliveredEventSchema = z
  .object({ id: z.string().regex(/^\d+-\d+$/), at: z.number().int(), event: serverEventSchema })
  .strict();
export type DeliveredEvent = z.infer<typeof deliveredEventSchema>;

/**
 * Reply to `resume`: missed events in order, or `snapshot: true` when too many were missed (reload
 * everything). `cursor` is the id to resume from next time, once this reply is handled.
 */
export const resumeReplySchema = z
  .object({
    events: z.array(deliveredEventSchema),
    snapshot: z.boolean(),
    cursor: z
      .string()
      .regex(/^\d+-\d+$/)
      .nullable(),
  })
  .strict();
export type ResumeReply = z.infer<typeof resumeReplySchema>;
