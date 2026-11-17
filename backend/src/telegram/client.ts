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

export interface TgStatus {
  state: 'disabled' | 'connecting' | 'listening' | 'error';
  channels: { id: string; title: string; folder: string | null }[];
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
  status: TgStatus = { state: 'disabled', channels: [], lastMessageAt: null, recoveredByPoll: 0, error: null };
  private client: TelegramClient | null = null;
  private watched = new Map<string, { title: string; folder: string | null }>(); // peerId -> channel
  private entities = new Map<string, Api.TypeChat | Api.TypeUser>(); // peerId -> entity, for polling
  private lastId = new Map<string, number>(); // peerId -> highest message id handled
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private opts: TgOptions) {
    super();
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

      for (const link of this.opts.folderLinks) await this.loadFolder(link);
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

  private addPeer(chat: Api.TypeChat | Api.TypeUser, folder: string | null) {
    const id = utils.getPeerId(chat as never);
    const title = 'title' in chat && chat.title ? chat.title : 'username' in chat && chat.username ? chat.username : id;
    this.watched.set(String(id), { title: String(title), folder });
    this.entities.set(String(id), chat);
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
      log('telegram', 'bad folder link', link);
      return;
    }
    const invite = await this.client.invoke(new Api.chatlists.CheckChatlistInvite({ slug }));
    if (invite instanceof Api.chatlists.ChatlistInviteAlready) {
      // Already in the folder: watch joined chats; join missing ones if allowed.
      const folder = (await this.folderTitle(invite.filterId)) ?? slug;
      for (const c of invite.chats) this.addPeer(c, folder);
      if (this.opts.autoJoin && invite.missingPeers.length) {
        await this.join(slug, invite.missingPeers);
      }
    } else {
      const folder = textOf((invite as any).title) ?? slug;
      for (const c of invite.chats) this.addPeer(c, folder);
      if (this.opts.autoJoin && invite.peers.length) await this.join(slug, invite.peers);
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
      this.addPeer(entity as Api.TypeChat, null);
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
    for (const [id, entity] of this.entities) {
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
        const minId = this.lastId.get(id) ?? 0;
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
