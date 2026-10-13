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
 * SMTP delivery through whichever relay SMTP_URL names (Mailpit locally, a transactional relay or
 * our own MTA later: docs/ADR/0006). Plain text only: no HTML, no links, no tracking pixels.
 */
@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport;

  constructor(@Inject(ENV) private readonly env: Env) {
    const implicitTls = env.SMTP_URL.startsWith('smtps:');
    this.transport = createTransport({
      url: env.SMTP_URL,
      // A few reused connections: a batch of codes does not open one SMTP session per email.
      pool: true,
      maxConnections: 4,
      // Production never sends a login code over an unencrypted hop.
      requireTLS: env.APP_ENV === 'production' && !implicitTls,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
