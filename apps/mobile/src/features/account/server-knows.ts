/**
 * "Sunucu ne biliyor?" (N2): what Bargu's server sees to work, each one a row of the accepted leaks
 * in docs/THREAT_MODEL.md ("Kabul edilen sızıntılar"), and what it cannot see because the phone
 * encrypts it first. A change there is a change here (the QA session compares the two).
 */
export const SERVER_SEES = [
  'email',
  'circles',
  'profile',
  'timing',
  'push',
  'ip',
  'account',
] as const;

export const SERVER_CANNOT_SEE = ['location', 'history', 'messages', 'places', 'sharing'] as const;
