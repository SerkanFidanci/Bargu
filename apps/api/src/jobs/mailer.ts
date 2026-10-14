import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Whether the connection must be encrypted before anything is sent: always in production, and
 * whenever the URL carries credentials (a password never travels in the clear). Implicit TLS
 * (smtps:) is encrypted from the first byte; the rest must upgrade with STARTTLS or fail.
 */
export function mustUpgradeToTls(smtpUrl: string, appEnv: string): boolean {
  const url = new URL(smtpUrl);
  if (url.protocol === 'smtps:') return false;
  return appEnv === 'production' || url.username !== '' || url.password !== '';
}

/** Reserved for testing (RFC 6761): never deliverable, so never handed to a real relay. */
export function isTestAddress(address: string): boolean {
  return /\.test$/i.test(address.trim());
}

function transportFor(smtpUrl: string, appEnv: string) {
  return createTransport({
    url: smtpUrl,
    // A few reused connections: a batch of codes does not open one SMTP session per email.
    pool: true,
    maxConnections: 4,
    // Production never sends a login code, and no environment a password, over an unencrypted hop.
    requireTLS: mustUpgradeToTls(smtpUrl, appEnv),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/**
 * SMTP delivery through whichever relay SMTP_URL names (Mailpit locally, a transactional relay or
 * our own MTA later: docs/ADR/0006). Plain text only: no HTML, no links, no tracking pixels.
 * Outside production, mail to reserved `.test` addresses goes to SMTP_TEST_URL (Mailpit) when set.
 */
@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport;
  private readonly testTransport;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = transportFor(env.SMTP_URL, env.APP_ENV);
    this.testTransport =
      env.SMTP_TEST_URL === undefined || env.APP_ENV === 'production'
        ? null
        : transportFor(env.SMTP_TEST_URL, env.APP_ENV);
  }

  async send(email: OutgoingEmail): Promise<void> {
    const transport =
      this.testTransport !== null && isTestAddress(email.to) ? this.testTransport : this.transport;
    await transport.sendMail({
      from: this.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  }

  onApplicationShutdown(): void {
    this.transport.close();
    this.testTransport?.close();
  }
}
