import { AlertCircle, CheckCircle2, Clock, Info, XCircle } from 'lucide-react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
  success:
    'bg-success-soft text-[#14532D] border-[#BBF7D0] dark:bg-success-soft dark:text-[#86EFAC] dark:border-[#14532D]',
  warning:
    'bg-warning-soft text-[#78350F] border-[#FDE68A] dark:bg-warning-soft dark:text-[#FCD34D] dark:border-[#78350F]',
  danger:
    'bg-danger-soft text-[#991B1B] border-[#FECACA] dark:bg-danger-soft dark:text-[#FCA5A5] dark:border-[#7F1D1D]',
  info:
    'bg-info-soft text-[#075985] border-[#BAE6FD] dark:bg-info-soft dark:text-[#7DD3FC] dark:border-[#0C4A6E]',
  accent:
    'bg-accent-soft text-[#115E59] border-[#99F6E4] dark:bg-accent-soft dark:text-[#34D399] dark:border-[#065F46]',
  neutral:
    'bg-surface-subtle text-text-primary border-border-strong',
};

function ToneIcon({ tone }: { tone: BadgeTone }) {
  const iconClass = 'h-3.5 w-3.5 shrink-0';
  switch (tone) {
    case 'success':
      return <CheckCircle2 className={iconClass} aria-hidden="true" />;
    case 'warning':
      return <Clock className={iconClass} aria-hidden="true" />;
    case 'danger':
      return <XCircle className={iconClass} aria-hidden="true" />;
    case 'info':
      return <Info className={iconClass} aria-hidden="true" />;
    case 'accent':
      return <CheckCircle2 className={iconClass} aria-hidden="true" />;
    case 'neutral':
      return <AlertCircle className={iconClass} aria-hidden="true" />;
  }
}

export function StatusBadge({
  tone,
  label,
}: {
  tone: BadgeTone;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-tight ${TONE_CLASSES[tone]}`}
    >
      <ToneIcon tone={tone} />
      <span>{label}</span>
    </span>
  );
}
