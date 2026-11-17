import { EventEmitter } from 'node:events';
import { log } from '../lib/util.js';

export interface PumpTrade {
  mint: string;
  txType: 'buy' | 'sell' | string;
  solAmount: number;
  tokenAmount: number;
  priceSol: number | null;
  marketCapSol?: number;
  pool?: string;
  ts: number;
}

/**
 * Single shared PumpPortal data socket (their docs ask for one connection).
 * Keeps the subscription set and re-subscribes after reconnect.
 */
export class PumpPortalWs extends EventEmitter {
  private ws: WebSocket | null = null;
  private keys = new Set<string>();
  private backoff = 1000;
  private stopped = false;
  connected = false;

  constructor(private url: string) {
    super();
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  subscribe(mint: string) {
    if (this.keys.has(mint)) return;
    this.keys.add(mint);
    this.send({ method: 'subscribeTokenTrade', keys: [mint] });
  }

  unsubscribe(mint: string) {
    if (!this.keys.delete(mint)) return;
    this.send({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  get tracked() {
    return this.keys.size;
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoff = 1000;
      log('pumpportal', 'connected');
      if (this.keys.size) this.send({ method: 'subscribeTokenTrade', keys: [...this.keys] });
      this.emit('status', true);
    };
    ws.onmessage = (ev) => {
      let m: Record<string, any>;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (typeof m.message === 'string' && /API key|only available/i.test(m.message)) {
        log('pumpportal', m.message);
        this.emit('notice', m.message);
        return;
      }
      if (!m.mint || !m.txType || typeof m.solAmount !== 'number') return; // acks / other messages
      const vSol = Number(m.vSolInBondingCurve);
      const vTok = Number(m.vTokensInBondingCurve);
      let priceSol: number | null = vSol > 0 && vTok > 0 ? vSol / vTok : null;
      if (priceSol === null && m.tokenAmount > 0) priceSol = m.solAmount / m.tokenAmount;
      this.emit('trade', {
        mint: m.mint, txType: m.txType, solAmount: m.solAmount, tokenAmount: Number(m.tokenAmount),
        priceSol, marketCapSol: m.marketCapSol, pool: m.pool, ts: Date.now(),
      } satisfies PumpTrade);
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit('status', false);
      if (this.stopped) return;
      log('pumpportal', `disconnected, retry in ${this.backoff}ms`);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
}
