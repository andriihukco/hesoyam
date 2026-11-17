import type { Snapshot } from '../lib/types';

const color: Record<string, string> = { trade: 'text-pos', warn: 'text-warn', info: 'text-label-2' };

/** What the bot did, newest first (memory only, last 80 lines). */
export function ActivityList({ s }: { s: Snapshot }) {
  return (
    <div className="mono scroll-y min-h-0 flex-1 space-y-1 px-4 py-3 text-[12px] leading-relaxed">
      {s.activity.map((a, i) => (
        <div key={i} className={`break-words ${color[a.level]}`}>
          <span className="text-label-3">{new Date(a.ts).toLocaleTimeString([], { hour12: false })}</span> {a.text}
        </div>
      ))}
      {!s.activity.length && <div className="py-10 text-center font-sans text-[15px] text-label-3">Nothing yet</div>}
    </div>
  );
}
