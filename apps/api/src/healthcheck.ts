// Container HEALTHCHECK entry point. The runtime image is distroless (no shell, curl or wget), so
// the check runs on the bundled Node binary: exit 0 when the API reports ready, 1 otherwise.
const port = process.env.PORT ?? '3000';

try {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
    signal: AbortSignal.timeout(2_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
