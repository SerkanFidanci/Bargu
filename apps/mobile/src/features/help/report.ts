import { Linking, Platform } from 'react-native';

import { env } from '@/config/env';

/** Where a problem report goes (the PM report Ö1, 2026-10-29). */
export const SUPPORT_EMAIL = 'support@otenus.com';
/**
 * A report's own words stay short: what happened and while doing what. Longer, the mailto address
 * grew past what some e-mail apps open (their body came empty, QA-40); more can be written there.
 */
export const REPORT_MAX = 500;

/**
 * The phone as a report names it: maker, model and system version, nothing that tells this phone
 * apart from others of its kind (no serial, no fingerprint).
 */
export function phoneModel(): string {
  if (Platform.OS === 'android') {
    const { Manufacturer, Model, Release } = Platform.constants;
    return `${Manufacturer} ${Model}, Android ${Release}`;
  }
  return `${Platform.OS} ${String(Platform.Version)}`;
}

/**
 * The e-mail a report is (Ö1): the user's words, then the app's version and the phone's model.
 * Never a location, a message or a name: only what the user wrote themselves.
 */
export function reportMail(
  words: string,
  labels: { subject: string; version: string; phone: string },
): string {
  const body = [
    words.trim(),
    '',
    '—',
    `${labels.version}: ${env.appVersion}`,
    `${labels.phone}: ${phoneModel()}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(labels.subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Opens the phone's e-mail app with the report ready (Ö1): the user sees it, can add a screenshot
 * there, and sends it themselves; nothing goes through Bargu's server. False when no e-mail app
 * could be opened.
 */
export async function openReport(mail: string): Promise<boolean> {
  try {
    await Linking.openURL(mail);
    return true;
  } catch {
    return false;
  }
}
