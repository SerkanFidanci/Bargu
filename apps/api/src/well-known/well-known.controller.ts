import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';

import { Public } from '../auth/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * Domain association files: passkeys and links work only when the domain vouches for the app
 * (Android Digital Asset Links, Apple associated domains).
 */
@Controller('.well-known')
@Public()
export class WellKnownController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('assetlinks.json')
  @Header('cache-control', 'public, max-age=3600')
  assetLinks() {
    if (this.env.ANDROID_CERT_SHA256.length === 0) return [];
    return [
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: this.env.ANDROID_PACKAGE,
          sha256_cert_fingerprints: this.env.ANDROID_CERT_SHA256,
        },
      },
    ];
  }

  @Get('apple-app-site-association')
  @Header('content-type', 'application/json')
  @Header('cache-control', 'public, max-age=3600')
  appleAppSiteAssociation() {
    const appId = this.env.IOS_APP_ID;
    if (appId === undefined) throw new NotFoundException();
    return {
      webcredentials: { apps: [appId] },
      applinks: { details: [{ appIDs: [appId], components: [{ '/': '/i/*' }] }] },
    };
  }
}
