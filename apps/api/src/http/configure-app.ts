import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Applies the HTTP hardening shared by the real server and the e2e tests. */
export function configureApp(app: NestFastifyApplication): NestFastifyApplication {
  // Helmet 8 defaults (CSP, HSTS, nosniff, frame-ancestors, ...) and no X-Powered-By.
  app.useSecurityHeaders();
  // Rejects cross-site browser requests; native clients send no Sec-Fetch-Site/Origin and pass.
  app.enableCsrfProtection();
  app.enableShutdownHooks();

  // CORS stays disabled: the only client is the native app.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });

  return app;
}
