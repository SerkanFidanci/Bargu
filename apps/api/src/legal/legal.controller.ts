import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../auth/request-context.js';
import { PRIVACY_PAGE_CSP, PRIVACY_PAGE_HTML } from './privacy-page.js';

/** Pages the Play listing and the KVKK notice point to (docs/ADR/0022). */
@Controller()
@Public()
export class LegalController {
  @Get('gizlilik')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', PRIVACY_PAGE_CSP)
  @Header('cache-control', 'public, max-age=300')
  @Header('referrer-policy', 'no-referrer')
  privacy(): string {
    return PRIVACY_PAGE_HTML;
  }
}
