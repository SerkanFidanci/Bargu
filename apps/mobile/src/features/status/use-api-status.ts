import { useEffect, useState } from 'react';

import { env } from '@/config/env';

export type ApiStatus = 'checking' | 'online' | 'offline';

const TIMEOUT_MS = 3_000;

/**
 * Faz 0 connectivity indicator: checks once, on mount, that this device can reach the API.
 * Not polling (CLAUDE.md); live state will arrive over the WebSocket from Faz 5 on.
 */
export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let unmounted = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    // Both outcomes are handled below, so the chain can never reject.
    void fetch(`${env.apiUrl}/health/live`, { signal: controller.signal })
      .then(
        (response): ApiStatus => (response.ok ? 'online' : 'offline'),
        (): ApiStatus => 'offline',
      )
      .then((next) => {
        if (!unmounted) setStatus(next);
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => {
      unmounted = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return status;
}
