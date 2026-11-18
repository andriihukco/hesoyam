import { useEffect, useState } from 'react';
import type { Snapshot } from './types';

const TOKEN_KEY = '1mbot.token';
const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};
export const setToken = (t: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
};

export async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-dashboard-token': token() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('unauthorized');
  const j = await res.json();
  if (j && j.ok === false) throw new Error(j.error);
  return j.result as T;
}

export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [needToken, setNeedToken] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token())}`);
      ws.onopen = () => setOnline(true);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'state') setSnap(m.data);
        // Token rotated (here or on another open dashboard): keep working with the new one.
        if (m.type === 'token' && typeof m.token === 'string') setToken(m.token);
      };
      ws.onclose = () => {
        setOnline(false);
        if (stopped) return;
        fetch('/api/state', { headers: { 'x-dashboard-token': token() } })
          .then((r) => setNeedToken(r.status === 401))
          .catch(() => {});
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { snap, online, needToken };
}

export const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;
export const sol = (n: number, d = 4) => `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(d)}`;
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
export const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
export const tone = (n: number) => (n > 0 ? 'text-pos' : n < 0 ? 'text-neg' : 'text-label-2');

/** Duration as "45s", "4m 12s", "2h 05m". */
export const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};
/** Token prices are tiny (1e-7 SOL); show significant digits instead of fixed decimals. */
export const px = (n: number) => (n > 0 ? n.toFixed(Math.min(14, Math.max(2, 3 - Math.floor(Math.log10(n))))) : '—');
