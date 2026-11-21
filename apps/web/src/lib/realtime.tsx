import { createRealtimeClient, type LiveQueryState, type SealedLiveQuery } from '@neon/realtime/client';
import { drizzleParsers } from '@neon/realtime-drizzle/client';
import { useLiveQuery } from '@neon/realtime-react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { erpApi, type RealtimeFeed } from './api.ts';

const realtimeUrl = import.meta.env.VITE_NEON_REALTIME_URL;
if (!realtimeUrl) {
  throw new Error('VITE_NEON_REALTIME_URL belum dikonfigurasi pada environment.');
}

export const realtimeClient = createRealtimeClient({
  url: realtimeUrl,
  parsers: { ...drizzleParsers },
});

export interface LiveFeedStatus {
  status: LiveQueryState['status'] | 'idle';
  errorMessage: string | null;
}

function ActiveLiveFeedSubscription({
  feed,
  initialSealed,
  queryKeysToInvalidate,
  onStatusChange,
}: {
  feed: RealtimeFeed;
  initialSealed: SealedLiveQuery<Record<string, unknown>>;
  queryKeysToInvalidate: QueryKey[];
  onStatusChange: (next: LiveFeedStatus) => void;
}) {
  const queryClient = useQueryClient();

  const refreshQuery = useCallback(() => erpApi.realtime.seal(feed), [feed]);

  const { status, error, utils } = useLiveQuery(initialSealed, {
    refreshQuery,
  });

  useEffect(() => {
    onStatusChange({
      status,
      errorMessage: error ? error.message : null,
    });
  }, [status, error, onStatusChange]);

  useEffect(() => {
    return utils.onUpdate((update) => {
      if (update.type === 'changes') {
        for (const key of queryKeysToInvalidate) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    });
  }, [utils, queryClient, queryKeysToInvalidate]);

  return null;
}

export function ErpRealtimeSubscriber({
  feed,
  enabled = true,
  queryKeysToInvalidate,
  onStatusChange,
}: {
  feed: RealtimeFeed;
  enabled?: boolean;
  queryKeysToInvalidate: QueryKey[];
  onStatusChange?: (next: LiveFeedStatus) => void;
}) {
  const [sealed, setSealed] = useState<SealedLiveQuery<Record<string, unknown>> | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);

  const reportStatus = useCallback(
    (next: LiveFeedStatus) => {
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  useEffect(() => {
    if (!enabled) {
      setSealed(null);
      reportStatus({ status: 'idle', errorMessage: null });
      return;
    }

    let cancelled = false;
    reportStatus({ status: 'connecting', errorMessage: null });

    erpApi.realtime
      .seal(feed)
      .then((res) => {
        if (!cancelled) {
          setSealed(res);
          setSealError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Gagal menyegel live query.';
          setSealError(msg);
          reportStatus({ status: 'error', errorMessage: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [feed, enabled, reportStatus]);

  if (!enabled || sealError || !sealed) {
    return null;
  }

  return (
    <ActiveLiveFeedSubscription
      feed={feed}
      initialSealed={sealed}
      queryKeysToInvalidate={queryKeysToInvalidate}
      onStatusChange={reportStatus}
    />
  );
}
