import type { ReactNode } from 'react';

export type Tab = 'home' | 'logs' | 'strategies' | 'settings';
export const TABS: Tab[] = ['home', 'logs', 'strategies', 'settings'];

const tabIcons: Record<Tab, ReactNode> = {
  home: <path d="M4 12.5 12 5l8 7.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1v-7.5Z" />,
  logs: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
  strategies: <path d="M5 7h9m4 0h1M5 17h1m4 0h9M16 4.5v5M8 14.5v5" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
};
export const tabLabels: Record<Tab, string> = { home: 'Positions', logs: 'Logs', strategies: 'Strategies', settings: 'Settings' };

export function TabIcon({ tab, className = 'h-6 w-6' }: { tab: Tab; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {tabIcons[tab]}
    </svg>
  );
}

/** iOS-style bottom tab bar, phones and small tablets only. */
export function TabBar({ tab, setTab, openPositions }: { tab: Tab; setTab: (t: Tab) => void; openPositions: number }) {
  return (
    <nav aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-sep bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
      <div className="mx-auto flex max-w-md">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${tab === t ? 'text-tint' : 'text-label-2'}`}>
            <TabIcon tab={t} />
            {tabLabels[t]}
            {t === 'home' && openPositions > 0 && (
              <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-neg-solid px-1 text-[11px] leading-[18px] text-white">{openPositions}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
