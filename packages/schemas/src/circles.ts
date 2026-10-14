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

export const circleCreateSchema = z
  .object({ kind: z.enum(GROUP_KINDS), name: circleNameSchema })
  .strict();
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

/** A member as other members see them: profile, and the active device's keys once they joined. */
export const memberCardSchema = z
  .object({
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
  })
  .strict();
export type MemberCard = z.infer<typeof memberCardSchema>;

export const circleSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(CIRCLE_KINDS),
    name: z.string().nullable(),
    /** Current sender-key epoch and when it began (Unix ms); see PROTOCOL §4. */
    epoch: z.number().int().positive(),
    epochStartedAt: z.number().int(),
    myRole: z.enum(MEMBER_ROLES),
    myStatus: z.enum(MEMBER_STATUSES),
    members: z.array(memberCardSchema).max(MAX_CIRCLE_MEMBERS),
  })
  .strict();
export type Circle = z.infer<typeof circleSchema>;

export const circlesSchema = z.object({ circles: z.array(circleSchema) }).strict();

export const usernameBodySchema = z.object({ username: usernameSchema }).strict();
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
      .object({ name: z.string().nullable(), kind: z.enum(CIRCLE_KINDS), memberCount: z.number() })
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
