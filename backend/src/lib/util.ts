export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 5000, ...init } = opts;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return (await res.json()) as T;
}

export function log(scope: string, ...args: unknown[]) {
  console.log(new Date().toISOString().slice(11, 23), `[${scope}]`, ...args);
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function startOfUtcDay(ts = Date.now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const memoStore = new Map<string, { at: number; p: Promise<unknown> }>();

/**
 * Share one in-flight or recent result per key for `ttlMs`. Arena lanes evaluate the same token
 * at almost the same moment; this keeps RPC / API calls at one per token instead of one per lane.
 * Rejected promises are not cached.
 */
export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn();
  memoStore.set(key, { at: now, p });
  p.catch(() => memoStore.delete(key));
  if (memoStore.size > 5000) for (const [k, v] of memoStore) if (now - v.at > 300_000) memoStore.delete(k);
  return p;
}
