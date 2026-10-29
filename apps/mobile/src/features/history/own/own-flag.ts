/**
 * One's own location history (docs/ADR/0030) ships with package D (the PM, 2026-10-29: "B APK'sında
 * Ö7'ye giriş gizli kalsın"): until then it records nothing, makes no key or file, and nothing on
 * screen leads to it. Turned on in package D's APK, with the privacy texts that describe it.
 */
export const OWN_HISTORY_ENABLED = false as boolean;
