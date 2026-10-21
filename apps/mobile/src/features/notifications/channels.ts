/** Android notification channels (users can tune each in the system settings). */
/** Friend and circle news, and pokes. */
export const SOCIAL_CHANNEL = 'social';
/** Arrivals and departures at places. */
export const PLACES_CHANNEL = 'places';
/** Event meetings: time to leave, someone will be late (docs/ADR/0018). */
export const MEETINGS_CHANNEL = 'meetings';
/**
 * "Güvendeyim" past the hourly limit from one person (QA-32 F-1): one summary line, low importance,
 * so it makes no sound and no vibration (docs/ADR/0029 §5).
 */
export const SAFE_QUIET_CHANNEL = 'safe-quiet';
/** The weekly "who sees you" reminder (BARGU_PLAN Faz 9): not to be muted with the social news. */
export const PRIVACY_CHANNEL = 'privacy';
/** The account's plan: the trial about to end (docs/ADR/0024 §4). */
export const ACCOUNT_CHANNEL = 'account';
