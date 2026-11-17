import { useState } from 'react';
import { call } from '../lib/api';
import type { Snapshot } from '../lib/types';
import { Group } from './ui';

/** Add or remove shared Telegram folder links (t.me/addlist/…) the bot watches. Changes apply without a restart. */
export function TelegramFolders({ s, onError }: { s: Snapshot; onError: (e: string) => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const folders = s.telegram.folders ?? [];
  const live = s.telegram.state === 'listening';

  const add = async () => {
    if (!link.trim()) return;
    setBusy(true);
    try {
      await call('POST', '/api/telegram/folders', { link: link.trim() });
      setLink('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = (l: string, name: string) =>
    confirm(`Stop watching "${name}"? You stay in its channels on Telegram.`) &&
    call('DELETE', '/api/telegram/folders', { link: l }).catch((e) => onError((e as Error).message));

  return (
    <Group title="Telegram folders"
      footer={live
        ? 'In Telegram: Settings → Folders → a folder → Share folder → copy the link. New folders apply at once; removing one stops watching it but does not leave its channels.'
        : `Telegram is ${s.telegram.state}. Links are saved and load when it connects.`}>
      {folders.map((f) => {
        const name = f.title ?? f.link.replace(/^https?:\/\//, '');
        return (
          <div key={f.link} className="row-sep flex items-center gap-3 px-4 py-2 text-[15px]">
            <div className="min-w-0 flex-1">
              <div className="truncate">{name}</div>
              <div className={`truncate text-[12px] ${f.error ? 'text-neg' : 'text-label-2'}`}>
                {f.error ?? (f.title ? `${f.channels} chat${f.channels === 1 ? '' : 's'}` : 'Not loaded yet')}
              </div>
            </div>
            <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neg-solid text-[15px] leading-none text-white"
              aria-label={`Remove folder ${name}`} onClick={() => remove(f.link, name)}>−</button>
          </div>
        );
      })}
      <form className="row-sep flex items-center gap-2 px-4 py-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/addlist/…" aria-label="Folder link"
          inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" className="field min-w-0 flex-1 py-1.5" />
        <button className="btn btn-filled btn-sm shrink-0" disabled={busy || !link.trim()}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
    </Group>
  );
}
