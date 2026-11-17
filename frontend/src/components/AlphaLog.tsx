import { useState } from 'react';
import { ago, call, pct, short } from '../lib/api';
import type { Signal, Snapshot } from '../lib/types';
import { Card, Segmented } from './ui';
import { Chats } from './Chats';
import { ActivityList } from './Activity';

const badge: Record<string, string> = {
  buy: 'bg-pos-solid/15 text-pos',
  reject: 'bg-fill text-label-2',
  skipped: 'bg-warn-solid/15 text-warn',
  error: 'bg-neg-solid/15 text-neg',
  pending: 'bg-tint/15 text-tint',
};

export function AlphaLog({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [tab, setTab] = useState<'signals' | 'mentions' | 'chats' | 'activity'>('signals');
  const [text, setText] = useState('');
  const now = s.serverTime;

  const inject = async () => {
    try {
      await call('POST', '/api/inject', { text });
      setText('');
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Card className="h-full" title="Logs" right={tab === 'signals' ? `${s.signals.length} signals` : tab === 'mentions' ? `${s.mentions.length} mentions` : tab === 'chats' ? `${s.chats.length} messages` : ''}>
      <div className="border-b border-sep p-2">
        <Segmented
          fill
          label="Log view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'signals', label: 'Signals' },
            { value: 'mentions', label: 'Mentions' },
            { value: 'chats', label: 'Chats', title: 'Every new message in watched chats' },
            { value: 'activity', label: 'Activity', title: 'What the bot did' },
          ]}
        />
      </div>
      {tab === 'activity' ? <ActivityList s={s} /> : tab === 'chats' ? <Chats s={s} /> : (<>
      <form
        className="flex gap-2 border-b border-sep p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void inject();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Contract address to inject"
          placeholder="Paste a CA to test"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          title="Skips the channel rule; risk and momentum checks still apply"
          className="field mono min-w-0 flex-1 text-[13px]"
        />
        <button className="btn btn-tinted" disabled={!text.trim()}>Inject</button>
      </form>
      <div className="scroll-y min-h-0 flex-1">
        {tab === 'signals'
          ? s.signals.length ? s.signals.map((sig) => <SignalRow key={sig.mint} sig={sig} now={now} />) : <Empty />
          : s.mentions.length
            ? s.mentions.map((m) => (
                <div key={m.id} className="row-sep px-4 py-2 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-tint">{m.channelName}</span>
                    <span className="mono text-label-2">{short(m.mint)}</span>
                    <span className="ml-auto text-label-3">{ago(m.ts, now)}</span>
                  </div>
                  <div className="truncate text-label-2">{m.snippet}</div>
                </div>
              ))
            : <Empty />}
      </div>
      </>)}
    </Card>
  );
}

function SignalRow({ sig, now }: { sig: Signal; now: number }) {
  const [open, setOpen] = useState(false);
  const delay = sig.firstPriceSol && sig.decisionPriceSol ? (sig.decisionPriceSol / sig.firstPriceSol - 1) * 100 : null;
  return (
    <div className="row-sep">
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold uppercase ${badge[sig.decision] ?? ''}`}>{sig.decision}</span>
        <div className="min-w-0 flex-1">
          <div className="mono truncate text-[15px]">{sig.symbol ? `$${sig.symbol}` : short(sig.mint)}</div>
          <div className="truncate text-[12px] text-label-2">{sig.channels.join(', ')}</div>
        </div>
        <ScoreRing score={sig.score} />
        <span className="w-8 shrink-0 text-right text-[12px] text-label-3">{ago(sig.firstSeen, now)}</span>
        <span className={`text-label-3 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="space-y-1.5 bg-card-2/60 px-4 py-3 text-[13px]">
          <div className="mono break-all text-label-2">{sig.mint}</div>
          <div className="flex gap-3">
            <a className="text-tint" href={`https://pump.fun/coin/${sig.mint}`} target="_blank" rel="noreferrer">pump.fun ↗</a>
            <a className="text-tint" href={`https://dexscreener.com/solana/${sig.mint}`} target="_blank" rel="noreferrer">DexScreener ↗</a>
          </div>
          {delay !== null && (
            <div className="text-label-2" title="Price at our entry vs. price at the first mention: the cost of waiting for confirmation.">
              Entry delay cost <span className={delay > 0 ? 'text-neg' : 'text-pos'}>{pct(delay)}</span>
            </div>
          )}
          {sig.reasons.map((r, i) => (
            <div key={i} className="flex gap-2">
              <span className={r.pass ? 'text-pos' : 'text-neg'}>{r.pass ? '✓' : '✕'}</span>
              <span className="w-28 shrink-0 text-label">{r.name}</span>
              <span className="min-w-0 text-label-2">{r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const c = score >= 70 ? 'var(--pos-solid)' : score >= 40 ? 'var(--warn-solid)' : 'var(--label-3)';
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
      style={{ background: `conic-gradient(${c} ${score * 3.6}deg, var(--fill) 0)` }}
      title={`Confidence ${score}/100`}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-card">{score}</span>
    </span>
  );
}

const Empty = () => <div className="px-4 py-10 text-center text-[15px] text-label-3">Nothing yet</div>;
