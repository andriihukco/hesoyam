import { Fragment, useMemo, useState } from 'react';
import { ago, short } from '../lib/api';
import type { ChatLine, Snapshot } from '../lib/types';
import { Segmented } from './ui';
import { CoinSheet } from './CoinSheet';

const tone: Record<string, string> = {
  buy: 'bg-pos-solid/15 text-pos',
  reject: 'bg-fill text-label-2',
  skipped: 'bg-warn-solid/15 text-warn',
  error: 'bg-neg-solid/15 text-neg',
  pending: 'bg-tint/15 text-tint',
};

/** Live feed of every message in watched chats, with the contract addresses found in each. */
export function Chats({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [coin, setCoin] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'ca'>('all');
  const [folder, setFolder] = useState<string>('*');
  const decisions = useMemo(() => new Map(s.signals.map((x) => [x.mint, x.decision])), [s.signals]);
  const folders = useMemo(
    () => [...new Set(s.telegram.channels.map((c) => c.folder ?? 'Channels'))],
    [s.telegram.channels],
  );
  const rows = s.chats.filter(
    (c) => (filter === 'all' || c.cas.some((x) => x.status === 'mint')) && (folder === '*' || (c.folder ?? 'Channels') === folder),
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-sep px-3 py-2">
        <Segmented label="Message filter" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'ca', label: 'With CA' }]} />
        {folders.length > 1 && (
          <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder"
            className="field ml-auto max-w-[50%] px-2 py-1 text-[13px]">
            <option value="*">All folders</option>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
      </div>
      <div className="scroll-y min-h-0 flex-1">
        {rows.length ? rows.map((c) => <ChatRow key={c.id} c={c} now={s.serverTime} decisions={decisions} onCoin={setCoin} />) : (
          <p className="px-4 py-10 text-center text-[13px] text-label-2">
            {s.telegram.state === 'listening'
              ? 'Waiting for new messages. Only messages since the bot started are shown; they are kept in memory, not saved.'
              : `Telegram is ${s.telegram.state}.`}
          </p>
        )}
      </div>
      {coin && <CoinSheet mint={coin} s={s} onClose={() => setCoin(null)} onError={onError} />}
    </>
  );
}

function ChatRow({ c, now, decisions, onCoin }: { c: ChatLine; now: number; decisions: Map<string, string>; onCoin: (mint: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row-sep px-4 py-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium text-tint">{c.channelName}</span>
        {c.folder && <span className="shrink-0 rounded bg-fill px-1.5 text-[11px] text-label-2">{c.folder}</span>}
        <span className="ml-auto shrink-0 text-label-3">{ago(c.ts, now)}</span>
      </div>
      <button className={`block w-full whitespace-pre-wrap break-words text-left text-label ${open ? '' : 'line-clamp-3'}`}
        onClick={() => setOpen(!open)} aria-expanded={open}>
        <Highlight text={c.text} cas={c.cas} />
      </button>
      {c.cas.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {c.cas.map((ca) => {
            const d = ca.status === 'mint' ? decisions.get(ca.address) : undefined;
            const label = ca.status === 'mint' ? (d ?? 'mint') : ca.status === 'not-mint' ? 'not a token' : ca.status;
            const cls = ca.status === 'mint' ? (tone[d ?? 'pending'] ?? tone.pending) : ca.status === 'error' ? tone.error : 'bg-fill text-label-3';
            return (
              <button key={ca.address} title={ca.status === 'mint' ? `${ca.address} — open chart` : `${ca.address} — click to copy`}
                onClick={() => (ca.status === 'mint' ? onCoin(ca.address) : void navigator.clipboard?.writeText(ca.address))}
                className={`mono rounded-md px-1.5 py-0.5 text-[11px] ${cls}`}>
                {short(ca.address)} · {label.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Highlight({ text, cas }: { text: string; cas: ChatLine['cas'] }) {
  const mints = cas.filter((x) => x.status === 'mint').map((x) => x.address);
  if (!mints.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${mints.join('|')})`));
  return (
    <>
      {parts.map((p, i) => (mints.includes(p)
        ? <mark key={i} className="mono rounded bg-tint/15 px-0.5 text-tint">{p}</mark>
        : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
