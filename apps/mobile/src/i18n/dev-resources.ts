import en from './locales/dev.en.json';
import tr from './locales/dev.tr.json';

/**
 * The texts of the developer tools. Not part of `resources` (./index.ts) on purpose: only
 * features/dev/tools.ts imports this file, so a production bundle does not carry them.
 */
export const devResources = {
  tr,
  en,
} as const;
