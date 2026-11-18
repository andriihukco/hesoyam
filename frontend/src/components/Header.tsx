import { useState, type ReactNode } from 'react';
import { ago, call, sol, tone } from '../lib/api';
import type { ThemePref } from '../lib/theme';
import type { Snapshot } from '../lib/types';
import { Dot, Switch } from './ui';

const Icon = {
  auto: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16V2Z" /><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>,
  light: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="10" cy="10" r="3.5" /><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4" /></svg>,
  dark: <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" /></svg>,
};

const nextTheme: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const themeName: Record<ThemePref, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

/** Top bar: identity, connection, theme, kill switch. Sticky on phones; on desktop it also carries the status strip. */
export function Header({ s, online, theme, setTheme, onError }: {
  s: Snapshot; online: boolean; theme: ThemePref; setTheme: (t: ThemePref) => void; onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggleKill = async (on: boolean) => {
    setBusy(true);
    try {
      await call('POST', '/api/kill-switch', { on });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-sep bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 lg:static">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
        <div className="mr-auto min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">1mbot</h1>
          <div className="flex items-center gap-1.5 text-[12px] text-label-2">
            <Dot tone={online ? 'pos' : 'neg'} />
            <span className="truncate">{online ? 'Connected' : 'Offline'}</span>
            <span className={`rounded px-1.5 text-[11px] font-semibold ${s.mode === 'paper' ? 'bg-tint/15 text-tint' : 'bg-neg-solid/15 text-neg'}`}
              title={s.mode === 'paper' ? 'Virtual wallet. Fills use live curve state and Jupiter quotes.' : 'Real funds'}>
              {s.mode === 'paper' ? 'PAPER' : 'LIVE'}
            </span>
          </div>
        </div>
        <div className="hidden lg:block"><StatusStrip s={s} compact /></div>
        <button type="button" className="icon-btn" onClick={() => setTheme(nextTheme[theme])}
          aria-label={`Appearance: ${themeName[theme]}. Tap to change.`} title={`Appearance: ${themeName[theme]}`}>
          {Icon[theme === 'system' ? 'auto' : theme]}
        </button>
        <label className={`flex items-center gap-2 rounded-full py-1 pl-3 pr-1 ${s.killSwitch ? 'bg-neg-solid/15' : 'bg-fill'}`}
          title="Blocks all new buys. Exits keep running.">
          <span className={`text-[13px] font-semibold ${s.killSwitch ? 'text-neg' : 'text-label-2'}`}>New buys {s.killSwitch ? 'off' : 'on'}</span>
          <Switch label="Kill switch: block all new buys" checked={s.killSwitch} disabled={busy} danger onChange={(on) => void toggleKill(on)} />
        </label>
      </div>
    </header>
  );
}

/** Wallet, PnL and connection health. Swipeable row on phones, inline row in the desktop header. */
export function StatusStrip({ s, compact }: { s: Snapshot; compact?: boolean }) {
  const equity = s.wallet.balanceSol + s.positions.reduce((a, p) => a + p.tokensHeld * p.lastPriceSol, 0);
  const total = equity - s.wallet.startingSol;
  const ping = s.rpc.pingMs;
  const tg = s.telegram.state;
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;
  const tiles: TileProps[] = [
    { label: 'Equity', value: sol(equity, 3), unit: 'SOL', sub: <span className={tone(total)}>{signed(total)}</span> },
    { label: 'Today', value: <span className={tone(s.stats.today.pnl)}>{signed(s.stats.today.pnl)}</span>, sub: `${s.stats.today.wins}/${s.stats.today.count} wins` },
    { label: `RPC ${s.rpc.current}`, value: ping == null ? '—' : ping, unit: ping == null ? '' : 'ms', dot: ping == null ? 'neg' : ping < 300 ? 'pos' : 'warn' },
    { label: 'Feed', value: s.feed.connected ? 'Live' : 'Down', sub: `${s.feed.tracked} subs`, dot: s.feed.connected ? 'pos' : 'neg' },
    {
      label: 'Telegram',
      value: tg === 'listening' ? 'On' : tg === 'disabled' ? 'Off' : tg === 'error' ? 'Error' : '…',
      sub: s.telegram.lastMessageAt ? `msg ${ago(s.telegram.lastMessageAt, s.serverTime)} ago` : `${s.telegram.channels.length} chats`,
      dot: tg === 'listening' ? 'pos' : tg === 'error' ? 'neg' : 'off',
      title: s.telegram.error ?? `${s.telegram.channels.length} chats. ${s.telegram.recoveredByPoll} messages recovered by polling (missed by live updates).`,
    },
    ...(['x', 'threads'] as const).filter((k) => s.social[k].state !== 'disabled').map((k): TileProps => {
      const x = s.social[k];
      return {
        label: k === 'x' ? 'X' : 'Threads',
        value: x.state === 'polling' ? 'On' : 'Error',
        sub: x.lastMessageAt ? `msg ${ago(x.lastMessageAt, s.serverTime)} ago` : `${x.accounts.length} feeds`,
        dot: x.state === 'polling' ? 'pos' : 'neg',
        title: x.error ?? `${x.accounts.join(', ')}. Each polled about every ${x.pollSec}s.`,
      };
    }),
  ];
  if (compact) {
    return (
      <div className="flex items-center gap-5 text-[13px]">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0" title={t.title}>
            <div className="flex items-center gap-1 text-[11px] text-label-2">{t.dot && <Dot tone={t.dot} />}{t.label}</div>
            <div className="whitespace-nowrap font-semibold">
              {t.value}{t.unit && <span className="ml-0.5 font-normal text-label-2">{t.unit}</span>}
              {t.sub && <span className="ml-1.5 text-[11px] font-normal text-label-2">{t.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
      {tiles.map((t) => <Tile key={t.label} {...t} />)}
    </div>
  );
}

interface TileProps { label: string; value: ReactNode; unit?: string; sub?: ReactNode; dot?: 'pos' | 'neg' | 'warn' | 'off'; title?: string }

function Tile({ label, value, unit, sub, dot, title }: TileProps) {
  return (
    <div className="card w-[118px] shrink-0 snap-start px-3 py-2" title={title}>
      <div className="flex items-center gap-1.5 truncate text-[12px] text-label-2">
        {dot && <Dot tone={dot} />}
        {label}
      </div>
      <div className="truncate text-[19px] font-semibold leading-snug">
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal text-label-2">{unit}</span>}
      </div>
      {sub && <div className="truncate text-[12px] text-label-2">{sub}</div>}
    </div>
  );
}
