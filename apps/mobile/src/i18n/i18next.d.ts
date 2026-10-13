import 'i18next';

import type tr from './locales/tr.json';

// Type-safe translation keys: `t('common.continue')` is checked against the Turkish source catalogue.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof tr };
  }
}
