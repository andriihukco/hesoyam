import { TelegramClient, Api, utils } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { StringSession } from 'telegram/sessions/index.js';
import { EventEmitter } from 'node:events';
import { errMsg, log, sleep } from '../lib/util.js';

export interface TgMessage {
  channelId: string;
  channelName: string;
  /** Folder name the channel came from; null for channels listed in TG_CHANNELS. */
  folder: string | null;
  text: string;
  ts: number;
}

export interface TgFolder {
  link: string;
  /** Folder title once resolved; null until the link has been checked. */
  title: string | null;
  channels: number;
  error: string | null;
}

export interface TgStatus {
  state: 'disabled' | 'connecting' | 'listening' | 'error';
  channels: { id: string; title: string; folder: string | null }[];
  folders: TgFolder[];
  /** When the last message from a watched chat arrived (push or poll), ms epoch. */
  lastMessageAt: number | null;
  /** Messages recovered by polling that the push stream missed (a sign push updates stalled). */
  recoveredByPoll: number;
  error: string | null;
}

export interface TgOptions {
  apiId?: number;
  apiHash?: string;
  session?: string;
  folderLinks: string[];
  extraChannels: string[];
  autoJoin: boolean;
}

/** Poll interval for the missed-message safety net. */
const POLL_MS = 20_000;

/** Telegram titles are a plain string in older layers and TextWithEntities in newer ones. */
function textOf(t: unknown): string | null {
  if (typeof t === 'string') return t || null;
  if (t && typeof t === 'object' && typeof (t as { text?: unknown }).text === 'string') return (t as { text: string }).text || null;
  return null;
}

/** Folder slug from https://t.me/addlist/<slug> (also tg://addlist?slug=). */
export function folderSlug(link: string): string | null {
  const m = link.match(/addlist[/?](?:slug=)?([A-Za-z0-9_-]+)/);
  return m ? m[1]! : null;
}

/**
 * Read-only MTProto user session. Resolves folder links, optionally joins them,
 * and emits `message` for every new post in a watched channel. Never sends messages.
 */
export class TelegramScraper extends EventEmitter {
  status: TgStatus = { state: 'disabled', channels: [], folders: [], lastMessageAt: null, recoveredByPoll: 0, error: null };
  private client: TelegramClient | null = null;
  private watched = new Map<string, { title: string; folder: string | null }>(); // peerId -> channel
  private entities = new Map<string, Api.TypeChat | Api.TypeUser>(); // peerId -> entity, for polling
  private lastId = new Map<string, number>(); // peerId -> highest message id handled
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  /** Folder link -> peer ids it contributed, so removing a folder only drops its own chats. */
  private folderPeers = new Map<string, Set<string>>();
  private extraPeers = new Set<string>();

  constructor(private opts: TgOptions) {
    super();
    this.status.folders = opts.folderLinks.map((link) => ({ link, title: null, channels: 0, error: null }));
  }

  /** Start watching a folder link now (when connected) and keep it in the list. */
  async addFolder(link: string): Promise<TgFolder> {
    link = link.trim();
    if (!folderSlug(link)) throw new Error('Not a folder link. Use https://t.me/addlist/…');
    if (this.opts.folderLinks.some((l) => folderSlug(l) === folderSlug(link))) throw new Error('Folder already added');
    if (this.client && this.status.state === 'listening') {
      // Throws on a bad or expired invite: nothing is saved and the row is dropped again.
      await this.loadFolder(link).catch((e) => {
        this.status.folders = this.status.folders.filter((f) => f.link !== link);
        throw e;
      });
      await this.primePeers(this.folderPeers.get(link) ?? new Set());
    }
    this.opts.folderLinks.push(link);
    const entry = this.status.folders.find((f) => f.link === link) ?? { link, title: null, channels: 0, error: null };
    if (!this.status.folders.includes(entry)) this.status.folders.push(entry);
    this.status.channels = this.channelList();
    return entry;
  }

  /** Stop watching a folder's chats. Does not leave the channels on the Telegram account. */
  removeFolder(link: string) {
    const peers = this.folderPeers.get(link) ?? new Set<string>();
    this.folderPeers.delete(link);
    this.opts.folderLinks = this.opts.folderLinks.filter((l) => l !== link);
    this.status.folders = this.status.folders.filter((f) => f.link !== link);
    for (const id of peers) {
      const stillUsed = this.extraPeers.has(id) || [...this.folderPeers.values()].some((s) => s.has(id));
      if (stillUsed) {
        // Keep the chat, labelled with a folder that still holds it.
        const other = [...this.folderPeers].find(([, s]) => s.has(id));
        const w = this.watched.get(id);
        if (w) w.folder = other ? (this.status.folders.find((f) => f.link === other[0])?.title ?? w.folder) : null;
        continue;
      }
      this.watched.delete(id);
      this.entities.delete(id);
      this.lastId.delete(id);
    }
    this.status.channels = this.channelList();
  }

  folderLinks() {
    return [...this.opts.folderLinks];
  }

  async start() {
    const { apiId, apiHash, session } = this.opts;
    if (!apiId || !apiHash || !session) {
      this.status = { ...this.status, state: 'disabled', channels: [], error: 'Set TG_API_ID, TG_API_HASH, TG_SESSION in .env (run npm run tg:login)' };
      log('telegram', 'not configured, scraper disabled');
      return;
    }
    this.status.state = 'connecting';
    try {
      this.client = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 10,
        autoReconnect: true,
        floodSleepThreshold: 120, // GramJS waits out FloodWait up to 2 min automatically
      });
      this.client.setLogLevel('error' as never);
      await this.client.connect();
      if (!(await this.client.checkAuthorization())) throw new Error('Session not authorized. Run npm run tg:login');

      for (const link of this.opts.folderLinks) {
        // One bad or expired link must not stop the others from loading.
        await this.loadFolder(link).catch((e) => log('telegram', `folder ${link}: ${errMsg(e)}`));
      }
      for (const ch of this.opts.extraChannels) await this.loadChannel(ch);

      this.client.addEventHandler((e: NewMessageEvent) => void this.onMessage(e), new NewMessage({}));
      this.status = { ...this.status, state: 'listening', channels: this.channelList(), error: null };
      await this.primePoll();
      this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
      log('telegram', `listening to ${this.watched.size} channels`);
    } catch (e) {
      this.status = { ...this.status, state: 'error', error: errMsg(e), channels: this.channelList() };
      log('telegram', 'error', errMsg(e));
    }
  }

  async stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.client?.disconnect().catch(() => {});
  }

  private channelList() {
    return [...this.watched].map(([id, c]) => ({ id, ...c }));
  }

  private addPeer(chat: Api.TypeChat | Api.TypeUser, folder: string | null): string {
    const id = String(utils.getPeerId(chat as never));
    const title = 'title' in chat && chat.title ? chat.title : 'username' in chat && chat.username ? chat.username : id;
    // A chat already watched via another folder keeps its first label.
    this.watched.set(id, { title: String(title), folder: this.watched.get(id)?.folder ?? folder });
    this.entities.set(id, chat);
    return id;
  }

  private setFolderStatus(link: string, patch: Partial<TgFolder>) {
    let f = this.status.folders.find((x) => x.link === link);
    if (!f) this.status.folders.push((f = { link, title: null, channels: 0, error: null }));
    Object.assign(f, patch);
  }

  /** Name of one of the user's own folders (dialog filters) by id; null if not found. */
  private async folderTitle(filterId: number): Promise<string | null> {
    try {
      const res: any = await this.client!.invoke(new Api.messages.GetDialogFilters());
      const list: any[] = Array.isArray(res) ? res : (res?.filters ?? []);
      const f = list.find((x) => x?.id === filterId);
      return textOf(f?.title);
    } catch {
      return null;
    }
  }

  private async loadFolder(link: string) {
    const slug = folderSlug(link);
    if (!slug || !this.client) {
      this.setFolderStatus(link, { error: 'Not a folder link' });
      throw new Error('Not a folder link');
    }
    try {
      const invite = await this.client.invoke(new Api.chatlists.CheckChatlistInvite({ slug }));
      const peers = new Set<string>();
      let folder: string;
      if (invite instanceof Api.chatlists.ChatlistInviteAlready) {
        // Already in the folder: watch joined chats; join missing ones if allowed.
        folder = (await this.folderTitle(invite.filterId)) ?? slug;
        for (const c of invite.chats) peers.add(this.addPeer(c, folder));
        if (this.opts.autoJoin && invite.missingPeers.length) {
          await this.join(slug, invite.missingPeers);
        }
      } else {
        folder = textOf((invite as any).title) ?? slug;
        for (const c of invite.chats) peers.add(this.addPeer(c, folder));
        if (this.opts.autoJoin && invite.peers.length) await this.join(slug, invite.peers);
      }
      this.folderPeers.set(link, peers);
      this.setFolderStatus(link, { title: folder, channels: peers.size, error: null });
    } catch (e) {
      this.setFolderStatus(link, { error: errMsg(e) });
      throw e;
    }
  }

  private async join(slug: string, peers: Api.TypePeer[]) {
    if (!this.client) return;
    const inputPeers = [];
    for (const p of peers) {
      inputPeers.push(await this.client.getInputEntity(p));
      await sleep(300); // slow down to avoid FloodWait
    }
    await this.client.invoke(new Api.chatlists.JoinChatlistInvite({ slug, peers: inputPeers }));
    log('telegram', `joined ${inputPeers.length} channels from folder ${slug}`);
  }

  private async loadChannel(ref: string) {
    if (!this.client) return;
    try {
      const entity = await this.client.getEntity(ref.replace(/^https?:\/\/t\.me\//, '').replace(/^@/, ''));
      this.extraPeers.add(this.addPeer(entity as Api.TypeChat, null));
    } catch (e) {
      log('telegram', `cannot resolve ${ref}: ${errMsg(e)}`);
    }
  }

  private async onMessage(e: NewMessageEvent) {
    const msg = e.message;
    if (!msg?.peerId) return;
    this.handle(String(utils.getPeerId(msg.peerId)), msg, false);
  }

  /** Shared by push updates and polling; drops anything already handled (ids grow per chat). */
  private handle(id: string, msg: Api.Message, fromPoll: boolean) {
    const ch = this.watched.get(id);
    if (!ch) return;
    if (msg.id <= (this.lastId.get(id) ?? 0)) return;
    this.lastId.set(id, msg.id);
    // Include link URLs from entities (e.g. hidden text links to pump.fun/coin/<mint>).
    const urls: string[] = [];
    for (const ent of msg.entities ?? []) if (ent instanceof Api.MessageEntityTextUrl) urls.push(ent.url);
    const text = [msg.message ?? '', ...urls].join(' ');
    if (!text.trim()) return;
    this.status.lastMessageAt = Date.now();
    if (fromPoll) this.status.recoveredByPoll++;
    this.emit('message', { channelId: id, channelName: ch.title, folder: ch.folder, text, ts: msg.date * 1000 } satisfies TgMessage);
  }

  /** Remember each chat's newest message id at start, so polling only picks up new messages. */
  private async primePoll() {
    await this.primePeers(new Set(this.entities.keys()));
  }

  private async primePeers(ids: Set<string>) {
    for (const id of ids) {
      const entity = this.entities.get(id);
      if (!entity || this.lastId.has(id)) continue;
      try {
        const [m] = await this.client!.getMessages(entity, { limit: 1 });
        if (m) this.lastId.set(id, Math.max(this.lastId.get(id) ?? 0, m.id));
      } catch (e) {
        log('telegram', `prime ${this.watched.get(id)?.title}: ${errMsg(e)}`);
      }
      await sleep(250);
    }
  }

  /**
   * Safety net: GramJS push updates can stop silently after a network blip while the client
   * still looks connected. Fetch anything newer than the last handled id in each chat.
   */
  private async poll() {
    if (this.polling || !this.client) return;
    this.polling = true;
    try {
      for (const [id, entity] of this.entities) {
        // Not primed yet (folder just added): polling from 0 would replay old messages as new.
        if (!this.lastId.has(id)) continue;
        const minId = this.lastId.get(id)!;
        try {
          const msgs = await this.client.getMessages(entity, { minId, limit: 20 });
          for (const m of [...msgs].reverse()) if (m instanceof Api.Message) this.handle(id, m, true);
        } catch (e) {
          log('telegram', `poll ${this.watched.get(id)?.title}: ${errMsg(e)}`);
        }
        await sleep(250); // spread requests to stay clear of FloodWait
      }
    } finally {
      this.polling = false;
    }
  }
}
