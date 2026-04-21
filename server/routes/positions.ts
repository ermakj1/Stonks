import { Router } from 'express';
import { getActiveAccountId, readAccount, buildOpenPositions, type Trade } from '../services/accounts.js';
import { getOptionMid } from '../services/cboe.js';

export const positionsRouter = Router();

interface OpenPosition {
  id: string;        // composite key (lotKey)
  ticker: string;
  assetType: 'stock' | 'option';
  optionType?: string;
  strike?: number;
  expiration?: string;
  notes: string;
  lastOpenTradeId: string;
  netQty: number;
  avgCostBasis: number;
  currentPrice: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
}

// GET /api/positions/unrealized
positionsRouter.get('/unrealized', async (_req, res) => {
  try {
    const accountId = await getActiveAccountId();
    const account = await readAccount(accountId);
    const trades: Trade[] = account.trades ?? [];

    const openMap = buildOpenPositions(trades);
    if (openMap.size === 0) {
      res.json([]);
      return;
    }

    const results: OpenPosition[] = await Promise.all(
      [...openMap.entries()].map(async ([id, pos]) => {
        const netQty = pos.lots.reduce((s, l) => s + l.qty, 0);
        const totalCost = pos.lots.reduce((s, l) => s + l.price * l.qty, 0);
        const avgCostBasis = netQty > 0 ? totalCost / netQty : 0;

        let currentPrice: number | null = null;
        let unrealizedGain: number | null = null;
        let unrealizedGainPct: number | null = null;

        try {
          if (pos.assetType === 'option' && pos.optionType && pos.strike != null && pos.expiration) {
            const mid = await Promise.race([
              getOptionMid(pos.ticker, pos.optionType, pos.strike, pos.expiration),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
            ]);
            currentPrice = mid?.mid ?? null;
          } else if (pos.assetType === 'stock') {
            const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
            const r = await Promise.race([
              fetch(`${YF_BASE}/${pos.ticker}?interval=1d&range=1d`, {
                headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
              }),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
            ]);
            if (r && 'json' in r && r.ok) {
              const json = await r.json() as { chart: { result: Array<{ meta: { regularMarketPrice: number } }> | null } };
              currentPrice = json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
            }
          }
        } catch {
          // price fetch failed — leave as null
        }

        if (currentPrice != null) {
          const multiplier = pos.assetType === 'option' ? 100 : 1;
          // For short options (open = sell to open): gain when price drops below cost basis
          const gain = pos.assetType === 'option'
            ? (avgCostBasis - currentPrice) * netQty * multiplier
            : (currentPrice - avgCostBasis) * netQty;
          unrealizedGain = gain;
          const totalCostBasis = avgCostBasis * netQty * (pos.assetType === 'option' ? multiplier : 1);
          unrealizedGainPct = totalCostBasis > 0 ? (gain / totalCostBasis) * 100 : null;
        }

        return { id, ticker: pos.ticker, assetType: pos.assetType, optionType: pos.optionType, strike: pos.strike, expiration: pos.expiration, notes: pos.notes, lastOpenTradeId: pos.lastOpenTradeId, netQty, avgCostBasis, currentPrice, unrealizedGain, unrealizedGainPct };
      })
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
