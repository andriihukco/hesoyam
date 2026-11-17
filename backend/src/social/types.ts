/** Status of one polling social source (X or Threads), shown in the dashboard. */
export interface SocialStatus {
  state: 'disabled' | 'polling' | 'error';
  /** Accounts (and, for Threads, keywords) being read. */
  accounts: string[];
  lastMessageAt: number | null;
  lastPollAt: number | null;
  /** Seconds between polls of the whole account list. */
  pollSec: number;
  error: string | null;
}

/** Channel id prefixes. The scorer uses them to tell social accounts from Telegram channels. */
export const SOCIAL_PREFIXES = ['x:', 'threads:'] as const;

export function isSocialChannel(id: string): boolean {
  return SOCIAL_PREFIXES.some((p) => id.startsWith(p));
}

/** `@name`, `name`, or a profile URL → bare lowercase handle. */
export function normHandle(s: string): string {
  return s.trim().replace(/^https?:\/\/(www\.)?(x|twitter|threads)\.(com|net)\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '').toLowerCase();
}
