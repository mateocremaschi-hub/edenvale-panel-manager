const TZ = (import.meta.env.VITE_DISPLAY_TZ as string) || 'Australia/Brisbane';

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d); // DD/MM/YYYY
}

export function formatTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatDateTime(input: string | Date): string {
  return `${formatDate(input)} ${formatTime(input)}`;
}
