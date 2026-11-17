import { describe, expect, it } from 'vitest';
import { TelegramScraper } from '../src/telegram/client.js';

const mk = (links: string[]) => new TelegramScraper({ folderLinks: links, extraChannels: [], autoJoin: false });

describe('telegram folder list', () => {
  it('lists links from options before connecting', () => {
    const t = mk(['https://t.me/addlist/abc']);
    expect(t.status.folders).toEqual([{ link: 'https://t.me/addlist/abc', title: null, channels: 0, error: null }]);
  });

  it('rejects bad and duplicate links', async () => {
    const t = mk(['https://t.me/addlist/abc']);
    await expect(t.addFolder('https://t.me/somechannel')).rejects.toThrow(/folder link/);
    await expect(t.addFolder('tg://addlist?slug=abc')).rejects.toThrow(/already/);
  });

  it('saves a link while offline and removes it again', async () => {
    const t = mk([]);
    await t.addFolder(' https://t.me/addlist/xyz ');
    expect(t.folderLinks()).toEqual(['https://t.me/addlist/xyz']);
    expect(t.status.folders).toHaveLength(1);
    t.removeFolder('https://t.me/addlist/xyz');
    expect(t.folderLinks()).toEqual([]);
    expect(t.status.folders).toEqual([]);
  });
});
