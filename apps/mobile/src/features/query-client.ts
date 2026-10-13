import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './auth/api-client';
import { onSignedOut } from './auth/auth-store';

/**
 * Server state cache. No polling and no refetch on focus (CLAUDE.md): data arrives once, then
 * changes only through mutation responses and, from Faz 5, WebSocket events that update the cache.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // A refusal from the server will not change on retry; a network failure might.
      retry: (failures, error) => !(error instanceof ApiError) && failures < 2,
    },
    mutations: { retry: false },
  },
});

// Nothing of one account may survive into the next sign-in on this phone.
onSignedOut(() => {
  queryClient.clear();
});
