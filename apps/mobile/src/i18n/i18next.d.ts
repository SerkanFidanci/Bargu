import 'i18next';

import type devTr from './locales/dev.tr.json';
import type tr from './locales/tr.json';

// Type-safe translation keys: `t('common.continue')` is checked against the Turkish source catalogue
// plus the developer texts, which are loaded only by development and preview builds (./dev-resources.ts).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof tr & typeof devTr };
  }
}
