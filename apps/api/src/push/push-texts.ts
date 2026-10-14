import type { LOCALES } from '@bargu/schemas';

/**
 * The only text that reaches Apple: the placeholder an iPhone shows if its Notification Service
 * Extension cannot open the sealed box in time (docs/ADR/0016). It says nothing about what
 * happened. Android notifications carry no text at all (the app writes them).
 */
const PLACEHOLDER: Record<(typeof LOCALES)[number], string> = {
  tr: 'Yeni bir bildirimin var',
  en: 'You have a new notification',
};

export function placeholderText(locale: (typeof LOCALES)[number]): { title: string; body: string } {
  return { title: 'Bargu', body: PLACEHOLDER[locale] };
}
