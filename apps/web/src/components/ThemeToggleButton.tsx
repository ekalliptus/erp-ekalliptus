import { Moon, Sun } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTheme } from '../lib/theme.tsx';

export function ThemeToggleButton({
  showLabel = false,
  className = '',
}: {
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    toggleTheme({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      aria-pressed={isDark}
      className={`ep-theme-toggle inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-subtle text-xs font-semibold text-text-primary hover:border-accent ${
        showLabel ? 'px-3' : 'w-9'
      } ${className}`}
    >
      <span className="relative h-4 w-4 shrink-0" aria-hidden="true">
        <Sun
          className={`ep-theme-icon absolute inset-0 h-4 w-4 ${
            isDark
              ? 'ep-theme-icon-active scale-100 rotate-0 opacity-100'
              : 'scale-[0.82] -rotate-[65deg] opacity-0'
          }`}
        />
        <Moon
          className={`ep-theme-icon absolute inset-0 h-4 w-4 ${
            !isDark
              ? 'ep-theme-icon-active scale-100 rotate-0 opacity-100'
              : 'scale-[0.82] rotate-[65deg] opacity-0'
          }`}
        />
      </span>
      {showLabel ? <span>{isDark ? 'Mode Terang' : 'Mode Gelap'}</span> : null}
    </button>
  );
}
