import { useEffect, useState } from 'react';
import { setToken, useSnapshot } from './lib/api';
import { useTheme } from './lib/theme';
import { Header, StatusStrip } from './components/Header';
import { AlphaLog } from './components/AlphaLog';
import { Positions } from './components/Positions';
import { StrategyConfig } from './components/StrategyConfig';
import { TabBar, TABS, type Tab } from './components/TabBar';
import { SideNav } from './components/SideNav';
import { PositionDetailSheet } from './components/PositionDetail';
import { ConfirmProvider } from './components/ConfirmSheet';
import { Settings } from './pages/Settings';

const TAB_KEY = '1mbot.tab';
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'strategy') return 'strategies';
    return TABS.includes(t as Tab) ? (t as Tab) : 'home';
  } catch {
    return 'home';
  }
};

export default function App() {
  return (
    <ConfirmProvider>
      <Shell />
    </ConfirmProvider>
  );
}

function Shell() {
  const { snap, online, needToken } = useSnapshot();
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState<Tab>(readTab);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const onError = (e: string) => {
    setError(e);
    setTimeout(() => setError(null), 6000);
  };
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* private mode */
    }
    window.scrollTo({ top: 0 });
  }, [tab]);

  if (needToken) {
    return (
      <form
        className="mx-auto mt-32 max-w-sm space-y-3 px-4"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(new FormData(e.currentTarget).get('t') as string);
          location.reload();
        }}
      >
        <h1 className="text-[28px] font-bold">Dashboard token</h1>
        <input name="t" type="password" autoComplete="current-password" aria-label="Dashboard token" className="field w-full" />
        <button className="btn btn-filled w-full">Continue</button>
      </form>
    );
  }
  if (!snap) return <div className="grid min-h-dvh place-items-center text-label-2">Connecting to bot…</div>;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <Header s={snap} online={online} theme={theme} setTheme={setTheme} onError={onError} />
      {error && (
        <div role="alert" className="fixed inset-x-4 top-[max(16px,env(safe-area-inset-top))] z-[60] mx-auto max-w-md rounded-2xl bg-neg-solid px-4 py-3 text-[15px] font-medium text-white shadow-lg">
          {error}
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 lg:min-h-0">
        <SideNav tab={tab} setTab={setTab} openPositions={snap.positions.length} />
        <main className="min-w-0 flex-1 px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-4">
          {tab === 'home' && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:h-full xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <section aria-label="Positions" className="flex min-h-0 flex-col gap-4">
                <div className="lg:hidden"><StatusStrip s={snap} /></div>
                {snap.arena.enabled && (
                  <div role="status" className="rounded-xl bg-warn-solid/15 px-4 py-2.5 text-[13px] font-medium text-warn">
                    Arena is running: main strategy is not opening new trades.
                  </div>
                )}
                <Positions s={snap} onError={onError} onOpen={setDetailId} />
              </section>
              <section aria-label="Logs" className="hidden min-h-0 flex-col xl:flex">
                <AlphaLog s={snap} onError={onError} />
              </section>
            </div>
          )}
          {tab === 'logs' && (
            <section aria-label="Logs" className="flex min-h-[70dvh] flex-col lg:h-full">
              <AlphaLog s={snap} onError={onError} />
            </section>
          )}
          {tab === 'strategies' && (
            <section aria-label="Strategies" className="mx-auto max-w-[760px]">
              <StrategyConfig s={snap} onError={onError} />
            </section>
          )}
          {tab === 'settings' && (
            <section aria-label="Settings" className="mx-auto max-w-[640px]"><Settings s={snap} onError={onError} /></section>
          )}
        </main>
      </div>
      {detailId !== null && <PositionDetailSheet id={detailId} s={snap} onClose={() => setDetailId(null)} onError={onError} />}
      <TabBar tab={tab} setTab={setTab} openPositions={snap.positions.length} />
    </div>
  );
}
