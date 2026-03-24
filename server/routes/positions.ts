import { Router } from 'express';
import { getActiveAccountId, readAccount, type Trade } from '../services/accounts.js';
import { getOptionMid } from '../services/cboe.js';

export const positionsRouter = Router();

interface OpenPosition {
  id: string;        // composite key (lotKey)
  ticker: string;
  assetType: 'stock' | 'option';
  optionType?: string;
  strike?: number;
  expiration?: string;
  netQty: number;
  avgCostBasis: number;
  currentPrice: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
}

function buildOpenPositions(trades: Trade[]): Map<string, { ticker: string; assetType: 'stock' | 'option'; optionType?: string; strike?: number; expiration?: string; lots: { price: number; qty: number }[] }> {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const positions = new Map<string, { ticker: string; assetType: 'stock' | 'option'; optionType?: string; strike?: number; expiration?: string; lots: { price: number; qty: number }[] }>();

  function lotKey(t: Trade): string {
    return t.assetType === 'option'
      ? `${t.ticker}-${t.optionType}-${t.strike}-${t.expiration}`
      : `${t.ticker}-stock`;
  }

  for (const t of sorted) {
    const key = lotKey(t);

    if (t.action === 'open' || (t.action === 'buy' && t.assetType === 'stock')) {
      const existing = positions.get(key) ?? { ticker: t.ticker, assetType: t.assetType, optionType: t.optionType, strike: t.strike, expiration: t.expiration, lots: [] };
      existing.lots.push({ price: t.price, qty: t.qty });
      positions.set(key, existing);

    } else if (
      t.action === 'close' || t.action === 'expired' || t.action === 'assigned' ||
      (t.action === 'sell' && t.assetType === 'stock')
    ) {
      const pos = positions.get(key);
      if (!pos) continue;
      let remaining = t.qty;
      while (remaining > 0 && pos.lots.length > 0) {
        const lot = pos.lots[0];
        const consumed = Math.min(remaining, lot.qty);
        lot.qty -= consumed;
        remaining -= consumed;
        if (lot.qty <= 0) pos.lots.shift();
      }
      if (pos.lots.length === 0) positions.delete(key);
    }
  }

  return positions;
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

        return { id, ticker: pos.ticker, assetType: pos.assetType, optionType: pos.optionType, strike: pos.strike, expiration: pos.expiration, netQty, avgCostBasis, currentPrice, unrealizedGain, unrealizedGainPct };
      })
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
