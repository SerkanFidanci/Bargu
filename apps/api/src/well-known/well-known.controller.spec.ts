import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseEnv } from '../config/env.js';
import { WellKnownController } from './well-known.controller.js';

const key = (fill: string) => fill.repeat(43);
const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/bargu',
  REDIS_URL: 'redis://default:pass@localhost:6379',
  JWT_SIGNING_KEY: key('a'),
  OTP_KEY: key('b'),
  EMAIL_LOOKUP_KEY: key('c'),
  JOB_PAYLOAD_KEY: key('d'),
  SMTP_URL: 'smtp://127.0.0.1:1025',
  MAIL_FROM: 'Bargu <no-reply@bargu.test>',
  WEBAUTHN_RP_ID: 'bargu.test',
  WEBAUTHN_ORIGINS: 'https://bargu.test',
};

const controller = (extra: Record<string, string>): WellKnownController =>
  new WellKnownController(parseEnv({ ...base, ...extra }));

/** The preview build's signing certificate: public, as it is in every APK (apksigner prints it). */
const PREVIEW_CERT =
  'BC:B3:1B:94:9A:2D:4F:86:2E:BD:41:5C:6E:C4:28:C5:16:3D:A7:76:F1:4B:49:E1:40:A3:CE:AD:57:FB:84:42';

describe('assetlinks.json (Android App Links for the invite host, docs/ADR/0009 Ek)', () => {
  it('names the package and every signing certificate set, one per build channel', () => {
    const production = 'CD'.repeat(32);
    const links = controller({
      ANDROID_PACKAGE: 'app.bargu',
      // Plain hex and colon form both work; the file always has the colon form.
      ANDROID_CERT_SHA256: `${PREVIEW_CERT.replaceAll(':', '').toLowerCase()}, ${production}`,
    }).assetLinks();
    expect(links).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'app.bargu',
          sha256_cert_fingerprints: [PREVIEW_CERT, Array(32).fill('CD').join(':')],
        },
      },
    ]);
  });

  it('vouches for nothing where no certificate is set (production until Faz 10)', () => {
    expect(controller({}).assetLinks()).toEqual([]);
    expect(controller({ ANDROID_CERT_SHA256: '' }).assetLinks()).toEqual([]);
  });

  it('opens invites and guardian requests of the iOS app too, when there is an app id', () => {
    const files = controller({ IOS_APP_ID: 'ABCDE12345.app.bargu' }).appleAppSiteAssociation();
    expect(files.applinks.details).toEqual([
      { appIDs: ['ABCDE12345.app.bargu'], components: [{ '/': '/i/*' }, { '/': '/g/*' }] },
    ]);
    expect(() => controller({}).appleAppSiteAssociation()).toThrow(NotFoundException);
  });
});
