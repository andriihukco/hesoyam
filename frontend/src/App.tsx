import { useEffect, useState } from 'react';
import { setToken, useSnapshot } from './lib/api';
import { useTheme } from './lib/theme';
import { Header, StatusStrip } from './components/Header';
import { AlphaLog } from './components/AlphaLog';
import { Positions } from './components/Positions';
import { StrategyConfig } from './components/StrategyConfig';
import { TabBar, type Tab } from './components/TabBar';
import { PositionDetailSheet } from './components/PositionDetail';

const TAB_KEY = '1mbot.tab';
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'logs' || t === 'strategy' ? t : 'home';
  } catch {
    return 'home';
  }
};

export default function App() {
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

  // Phones: one pane at a time, switched by the tab bar. Desktop: all panes side by side, each scrolling on its own.
  const pane = (t: Tab) => (tab === t ? 'flex' : 'hidden lg:flex');

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <Header s={snap} online={online} theme={theme} setTheme={setTheme} onError={onError} />
      {error && (
        <div role="alert" className="fixed inset-x-4 top-[max(16px,env(safe-area-inset-top))] z-30 mx-auto max-w-md rounded-2xl bg-neg-solid px-4 py-3 text-[15px] font-medium text-white shadow-lg">
          {error}
        </div>
      )}
      <main
        className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 px-4 pb-[calc(84px+env(safe-area-inset-bottom))] pt-3
          lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,auto)_minmax(0,1fr)] lg:pb-4
          lg:content-stretch lg:[grid-template-areas:'pos_strat'_'logs_strat']
          xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_380px] xl:grid-rows-[minmax(0,1fr)] xl:[grid-template-areas:'pos_logs_strat']"
      >
        <section aria-label="Positions" className={`${pane('home')} min-h-0 flex-col gap-4 lg:max-h-[42dvh] lg:[grid-area:pos] xl:max-h-none`}>
          <div className="lg:hidden"><StatusStrip s={snap} /></div>
          <Positions s={snap} onError={onError} onOpen={setDetailId} />
        </section>
        <section aria-label="Logs" className={`${pane('logs')} min-h-0 flex-col lg:[grid-area:logs]`}>
          <AlphaLog s={snap} onError={onError} />
        </section>
        <section aria-label="Strategy" className={`${pane('strategy')} min-h-0 flex-col lg:[grid-area:strat] lg:overflow-y-auto lg:overscroll-contain`}>
          <StrategyConfig s={snap} onError={onError} />
        </section>
      </main>
      {detailId !== null && <PositionDetailSheet id={detailId} s={snap} onClose={() => setDetailId(null)} onError={onError} />}
      <TabBar tab={tab} setTab={setTab} openPositions={snap.positions.length} />
    </div>
  );
}
