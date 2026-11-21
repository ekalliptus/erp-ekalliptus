import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

function applyDomTheme(next: ThemeMode) {
  const root = document.documentElement;
  if (next === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem('ep-theme', next);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    applyDomTheme(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, []);

  function commitThemeWithTransition(next: ThemeMode, origin?: ThemeOrigin) {
    if (typeof document === 'undefined') {
      setThemeState(next);
      return;
    }

    const doc = document as Document & ViewTransitionDoc;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (typeof doc.startViewTransition === 'function') {
      try {
        const transition = doc.startViewTransition(() => {
          applyDomTheme(next);
          flushSync(() => {
            setThemeState(next);
          });
        });

        const x = origin?.x ?? window.innerWidth - 40;
        const y = origin?.y ?? 32;
        const maxRadius = Math.hypot(
          Math.max(x, window.innerWidth - x),
          Math.max(y, window.innerHeight - y),
        );

        void transition.ready
          .then(() => {
            if (reduceMotion) {
              document.documentElement.animate(
                { opacity: [0, 1] },
                {
                  duration: 180,
                  easing: 'ease-out',
                  pseudoElement: '::view-transition-new(root)',
                },
              );
              return;
            }

            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${maxRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 460,
                easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
                pseudoElement: '::view-transition-new(root)',
              },
            );
          })
          .catch(() => {
            // Ignore aborted view transitions on rapid repeated clicks.
          });
        return;
      } catch {
        // Fall through to named-property CSS transition fallback.
      }
    }

    const root = document.documentElement;
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    root.classList.add('ep-theme-fallback');
    applyDomTheme(next);
    setThemeState(next);
    fallbackTimerRef.current = window.setTimeout(() => {
      root.classList.remove('ep-theme-fallback');
      fallbackTimerRef.current = null;
    }, 280);
  }

  const setTheme = (next: ThemeMode, origin?: ThemeOrigin) => {
    commitThemeWithTransition(next, origin);
  };

  const toggleTheme = (origin?: ThemeOrigin) => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    commitThemeWithTransition(next, origin);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
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
