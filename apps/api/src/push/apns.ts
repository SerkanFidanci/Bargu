import { connect, type ClientHttp2Session } from 'node:http2';

import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

import type { SendResult } from './fcm.js';

/** Apple refuses provider tokens older than an hour and renewals more often than every 20 min. */
const TOKEN_LIFETIME_MS = 50 * 60_000;

export interface ApnsConfig {
  /** The .p8 signing key (PKCS #8 PEM) from the Apple developer account. */
  key: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id. */
  topic: string;
  /** https://api.push.apple.com, or the sandbox for development builds. */
  origin: string;
}

export interface ApnsMessage {
  token: string;
  /** Shown only if the Notification Service Extension cannot open the sealed box. */
  title: string;
  body: string;
  /** The sealed notification (docs/PROTOCOL.md §7), for the extension. */
  sealed: string;
}

/** APNs refused the message for good (malformed): retrying will not help. */
export class ApnsRejected extends Error {
  override readonly name = 'ApnsRejected';
}

const errorSchema = z.object({ reason: z.string() });
const DEAD_TOKEN = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

/**
 * Apple Push Notification service over HTTP/2 with a token-based (.p8) provider key, called
 * directly (no third-party relay). Every alert is `mutable-content`: the iOS Notification Service
 * Extension replaces the placeholder text with what it decrypts; Apple sees only ciphertext.
 */
export class ApnsClient {
  private session: ClientHttp2Session | null = null;
  private token: { value: string; at: number } | null = null;

  constructor(
    private readonly config: ApnsConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: ApnsMessage): Promise<SendResult> {
    const { status, body } = await this.request(message);
    if (status === 200) return 'sent';
    const parsed = errorSchema.safeParse(safeJson(body));
    const reason = parsed.success ? parsed.data.reason : '';
    if (status === 410 || DEAD_TOKEN.has(reason)) return 'unregistered';
    if (status === 403) this.token = null;
    if (status === 400 || status === 413) throw new ApnsRejected(reason || 'BadRequest');
    // 403 (provider token), 429, 5xx: worth another try later (the queue retries with backoff).
    throw new Error(`APNs ${String(status)}`);
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }

  private async providerToken(): Promise<string> {
    if (this.token !== null && this.now() - this.token.at < TOKEN_LIFETIME_MS) {
      return this.token.value;
    }
    const at = this.now();
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId })
      .setIssuer(this.config.teamId)
      .setIssuedAt(Math.floor(at / 1000))
      .sign(await importPKCS8(this.config.key, 'ES256'));
    this.token = { value, at };
    return value;
  }

  private connection(): ClientHttp2Session {
    if (this.session === null || this.session.closed || this.session.destroyed) {
      const session = connect(this.config.origin);
      // A broken connection is replaced on the next send; errors surface on the request.
      session.on('error', () => {
        if (this.session === session) this.session = null;
      });
      session.on('goaway', () => {
        if (this.session === session) this.session = null;
      });
      this.session = session;
    }
    return this.session;
  }

  private async request(message: ApnsMessage): Promise<{ status: number; body: string }> {
    const authorization = `bearer ${await this.providerToken()}`;
    const payload = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        'mutable-content': 1,
        sound: 'default',
      },
      bargu: message.sealed,
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error: Error | null, result?: { status: number; body: string }) => {
        if (settled) return;
        settled = true;
        if (error !== null || result === undefined) reject(error ?? new Error('APNs failed'));
        else resolve(result);
      };
      const stream = this.connection().request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(message.token)}`,
        authorization,
        'apns-topic': this.config.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        // Older than an hour is better told by the app itself when it opens.
        'apns-expiration': String(Math.floor(this.now() / 1000) + 3600),
        'content-type': 'application/json',
      });
      let status = 0;
      let body = '';
      stream.setEncoding('utf8');
      stream.setTimeout(10_000, () => {
        stream.close();
      });
      stream.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => {
        done(status === 0 ? new Error('APNs closed the stream') : null, { status, body });
      });
      stream.on('close', () => {
        done(new Error('APNs closed the stream'));
      });
      stream.on('error', (error: Error) => {
        done(error);
      });
      stream.end(payload);
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
