import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import tr from './locales/tr.json';

export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'tr';

export const resources = {
  tr: { translation: tr },
  en: { translation: en },
} as const;

/** Maps the device language to a supported one; Turkish is the default. */
export function resolveLanguage(languageCode: string | null | undefined): Language {
  return SUPPORTED_LANGUAGES.find((language) => language === languageCode) ?? DEFAULT_LANGUAGE;
}

void i18next.use(initReactI18next).init({
  resources,
  // getLocales() always returns at least one entry, ordered by user preference.
  lng: resolveLanguage(getLocales()[0].languageCode),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // Resources are bundled, so initialise synchronously and render translated text on first frame.
  initAsync: false,
  // React already escapes rendered strings.
  interpolation: { escapeValue: false },
});

export default i18next;
