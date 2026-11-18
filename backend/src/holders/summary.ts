import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { HolderReport } from './score.js';

let client: Anthropic | null = null;

const SYSTEM = `You review the top holders of a new Solana memecoin for a paper-trading bot.
You get JSON with each holder's share of supply, SOL balance, wallet age, funding wallet, buys and sells of this coin,
other tokens held, links to coins that rugged before, and a rule-based risk score with flags.
Write at most 6 short bullet points in plain English: who controls the supply, signs of one operator behind many wallets
(shared funder, fresh wallets, the same other tokens), whether insiders are already selling, and rug history.
End with one line "Verdict: low / medium / high risk" and the main reason. Only state what the data shows;
say when data is missing. No financial advice, no price predictions.`;

/** Claude's short written read of a holder report. Called on demand from the dashboard. */
export async function summarize(report: HolderReport): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('set ANTHROPIC_API_KEY to get an AI summary');
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const data = {
    riskScore: report.riskScore,
    flags: report.flags,
    holders: report.wallets.map((w) => ({
      wallet: `${w.owner.slice(0, 4)}…${w.owner.slice(-4)}`,
      pctOfSupply: +w.pct.toFixed(2),
      solBalance: w.solBalance === null ? null : +w.solBalance.toFixed(3),
      walletAgeDays: w.firstSeenTs ? +((report.at - w.firstSeenTs) / 86_400_000).toFixed(1) : 'unknown (100+ txs)',
      fundedBy: w.fundedBy ? `${w.fundedBy.slice(0, 4)}…${w.fundedBy.slice(-4)}` : null,
      buys: w.buys, sells: w.sells, solSpent: +w.solOut.toFixed(3), solReceived: +w.solIn.toFixed(3),
      otherTokensHeld: w.otherTokenCount, rugLinks: w.rugLinks, flags: w.flags,
    })),
  };
  const res = await client.beta.messages.create({
    model: env.HOLDER_AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(data) }],
  });
  if (res.stop_reason === 'refusal') throw new Error('the model declined to summarize this report');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  if (!text) throw new Error(`empty summary (stop: ${res.stop_reason})`);
  return text;
}
