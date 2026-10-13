import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';

const JSON_CONTENT_TYPE = /^application\/json(;|$)/i;

/** Applies the HTTP hardening shared by the real server and the e2e tests. */
export function configureApp(app: NestFastifyApplication): NestFastifyApplication {
  // Helmet 8 defaults (CSP, HSTS, nosniff, frame-ancestors, ...) and no X-Powered-By.
  app.useSecurityHeaders();
  // Rejects cross-site browser requests; native clients send no Sec-Fetch-Site/Origin and pass.
  app.enableCsrfProtection();
  app.enableShutdownHooks();
  // Socket.io on the same HTTP server (events gateway at /v1/events).
  app.useWebSocketAdapter(new IoAdapter(app));

  // CORS stays disabled: the only client is the native app.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
  // The API speaks JSON only. Any other body type is refused before parsing, so request signatures
  // (computed over the raw JSON bytes) always cover the body that the handler sees.
  fastify.addHook('onRequest', (request, reply, done) => {
    const hasBody =
      request.headers['transfer-encoding'] !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0;
    const type = request.headers['content-type'] ?? '';
    if (hasBody && !JSON_CONTENT_TYPE.test(type)) {
      void reply
        .status(415)
        .send({ statusCode: 415, error: 'UNSUPPORTED_MEDIA_TYPE', code: 'VALIDATION_FAILED' });
      return;
    }
    done();
  });

  return app;
}
