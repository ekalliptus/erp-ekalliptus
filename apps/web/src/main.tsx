import './styles/app.css';
import { RealtimeProvider } from '@neon/realtime-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { realtimeClient } from './lib/realtime.tsx';
import { ThemeProvider } from './lib/theme.tsx';
import { router } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root tidak ditemukan.');
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider client={realtimeClient}>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
