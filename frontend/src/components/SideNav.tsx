import { TABS, TabIcon, tabLabels, type Tab } from './TabBar';

/** Desktop navigation (lg and up). Phones use the bottom TabBar. */
export function SideNav({ tab, setTab, openPositions }: { tab: Tab; setTab: (t: Tab) => void; openPositions: number }) {
  return (
    <nav aria-label="Sections" className="hidden w-[188px] shrink-0 flex-col gap-0.5 px-3 pt-3 lg:flex">
      {TABS.map((t) => (
        <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[15px] ${tab === t ? 'bg-fill font-semibold text-tint' : 'text-label hover:bg-fill'}`}>
          <TabIcon tab={t} className="h-5 w-5" />
          <span className="flex-1">{tabLabels[t]}</span>
          {t === 'home' && openPositions > 0 && (
            <span className="min-w-[20px] rounded-full bg-neg-solid px-1.5 text-center text-[12px] leading-[20px] text-white">{openPositions}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
