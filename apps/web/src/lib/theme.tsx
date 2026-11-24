import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark';

export interface ThemeOrigin {
  x: number;
  y: number;
}

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (next: ThemeMode, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
}

interface ViewTransitionHandle {
  ready: Promise<void>;
  finished: Promise<void>;
}

interface ViewTransitionDoc {
  startViewTransition?: (updateCallback: () => void) => ViewTransitionHandle;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

function applyDomThemeClass(next: ThemeMode) {
  document.documentElement.classList.toggle('dark', next === 'dark');
}

function persistTheme(next: ThemeMode) {
  try {
    localStorage.setItem('ep-theme', next);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);
  const themeRef = useRef<ThemeMode>(theme);
  const pendingPersistRef = useRef<ThemeMode | null>(null);
  const activeAnimationRef = useRef<Animation | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const transitionSeqRef = useRef(0);

  themeRef.current = theme;

  useEffect(() => {
    const flushPendingPersist = () => {
      if (pendingPersistRef.current !== null) {
        persistTheme(pendingPersistRef.current);
        pendingPersistRef.current = null;
      }
    };

    window.addEventListener('pagehide', flushPendingPersist);
    return () => {
      window.removeEventListener('pagehide', flushPendingPersist);
      flushPendingPersist();
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      try {
        activeAnimationRef.current?.cancel();
      } catch {
        // Ignore animation cancellation errors on teardown.
      }
      activeAnimationRef.current = null;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('ep-theme-switching');
      }
    };
  }, []);

  const commitThemeWithTransition = useCallback((next: ThemeMode, origin?: ThemeOrigin) => {
    if (next === themeRef.current) return;
    themeRef.current = next;

    if (typeof document === 'undefined') {
      setThemeState(next);
      return;
    }

    const root = document.documentElement;
    const seq = ++transitionSeqRef.current;
    const doc = document as Document & ViewTransitionDoc;

    const vw = Math.max(window.innerWidth, document.documentElement.clientWidth);
    const vh = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      window.visualViewport?.height ?? 0,
    );
    const x = Math.round(origin?.x ?? vw - 40);
    const y = Math.round(origin?.y ?? 32);
    const baseRadius = Math.hypot(
      Math.max(x, vw - x),
      Math.max(y, vh - y),
    );
    const maxRadius = Math.ceil(baseRadius * 1.1 + 48);

    if (typeof doc.startViewTransition === 'function') {
      try {
        try {
          activeAnimationRef.current?.cancel();
        } catch {
          // Ignore animation cancellation errors on aborted transitions.
        }
        activeAnimationRef.current = null;
        pendingPersistRef.current = next;

        const transition = doc.startViewTransition(() => {
          root.classList.add('ep-theme-switching');
          applyDomThemeClass(next);
          flushSync(() => {
            setThemeState(next);
          });
        });

        void transition.ready
          .then(() => {
            if (transitionSeqRef.current !== seq) return;
            activeAnimationRef.current = document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${maxRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 420,
                easing: 'cubic-bezier(0.32, 0, 0.68, 1)',
                fill: 'both',
                pseudoElement: '::view-transition-new(root)',
              },
            );
          })
          .catch(() => {
            // Ignore aborted view transitions on rapid repeated clicks.
          });

        void transition.finished
          .catch(() => {
            // Ignore aborted view transitions on rapid repeated clicks.
          })
          .finally(() => {
            if (transitionSeqRef.current === seq) {
              root.classList.remove('ep-theme-switching');
              activeAnimationRef.current = null;
              if (pendingPersistRef.current !== null) {
                persistTheme(pendingPersistRef.current);
                pendingPersistRef.current = null;
              }
            }
          });
        return;
      } catch {
        if (transitionSeqRef.current === seq) {
          root.classList.remove('ep-theme-switching');
          activeAnimationRef.current = null;
        }
        // Fall through to named-property CSS transition fallback.
      }
    }

    root.classList.remove('ep-theme-switching');
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    root.classList.add('ep-theme-fallback');
    applyDomThemeClass(next);
    persistTheme(next);
    pendingPersistRef.current = null;
    setThemeState(next);
    fallbackTimerRef.current = window.setTimeout(() => {
      root.classList.remove('ep-theme-fallback');
      fallbackTimerRef.current = null;
    }, 280);
  }, []);

  const setTheme = useCallback(
    (next: ThemeMode, origin?: ThemeOrigin) => {
      commitThemeWithTransition(next, origin);
    },
    [commitThemeWithTransition],
  );

  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => {
      const next: ThemeMode = themeRef.current === 'dark' ? 'light' : 'dark';
      commitThemeWithTransition(next, origin);
    },
    [commitThemeWithTransition],
  );

  const contextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme harus digunakan di dalam ThemeProvider.');
  }
  return ctx;
}
