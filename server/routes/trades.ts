import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getActiveAccountId, readAccount, writeAccount, type Account, type Trade } from '../services/accounts.js';

export const tradesRouter = Router();

async function getAccount() {
  const id = await getActiveAccountId();
  return readAccount(id);
}

/** Build OCC symbol from trade fields, e.g. TSLA260417C00450000 */
function tradeToOccKey(trade: Trade): string | null {
  if (trade.assetType !== 'option' || !trade.optionType || !trade.strike || !trade.expiration) return null;
  const [year, month, day] = trade.expiration.split('-');
  const yy = year.slice(2);
  const cp = trade.optionType === 'call' ? 'C' : 'P';
  const strikeStr = String(Math.round(trade.strike * 1000)).padStart(8, '0');
  return `${trade.ticker}${yy}${month}${day}${cp}${strikeStr}`;
}

const CLOSE_ACTIONS = new Set<Trade['action']>(['close', 'expired', 'assigned', 'sell']);

/** Sync account.holdings after a closing trade is recorded. */
function syncHoldingsOnClose(account: Account, trade: Trade): void {
  if (!CLOSE_ACTIONS.has(trade.action)) return;

  if (trade.assetType === 'option') {
    const key = tradeToOccKey(trade);
    if (key && key in account.holdings.options) {
      const opt = account.holdings.options[key] as { contracts?: number };
      if (opt && (opt.contracts ?? 0) !== 0) {
        // Remove owned option from holdings; leave watchlist entries (contracts===0) alone
        delete account.holdings.options[key];
        account.holdings.lastUpdated = new Date().toISOString().split('T')[0];
      }
    }
  } else if (trade.assetType === 'stock' && trade.action === 'sell') {
    const stock = account.holdings.stocks[trade.ticker] as { shares?: number } | undefined;
    if (stock && (stock.shares ?? 0) > 0) {
      stock.shares = Math.max(0, (stock.shares ?? 0) - trade.qty);
      account.holdings.lastUpdated = new Date().toISOString().split('T')[0];
    }
  }
}

// GET /api/trades
tradesRouter.get('/', async (_req, res) => {
  try {
    const account = await getAccount();
    res.json(account.trades ?? []);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/trades
tradesRouter.post('/', async (req, res) => {
  try {
    const body = req.body as Omit<Trade, 'id'>;
    const trade: Trade = { ...body, id: randomUUID() };
    const account = await getAccount();
    account.trades = [trade, ...(account.trades ?? [])];
    syncHoldingsOnClose(account, trade);
    await writeAccount(account);
    res.json(trade);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/trades/bulk — add multiple trades atomically
tradesRouter.post('/bulk', async (req, res) => {
  try {
    const incoming = req.body as Omit<Trade, 'id'>[];
    if (!Array.isArray(incoming)) { res.status(400).json({ error: 'Array expected' }); return; }
    const newTrades: Trade[] = incoming.map(t => ({ ...t, id: randomUUID() }));
    const account = await getAccount();
    account.trades = [...newTrades, ...(account.trades ?? [])];
    await writeAccount(account);
    res.json(newTrades);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// PUT /api/trades/:id
tradesRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await getAccount();
    const trades = account.trades ?? [];
    const idx = trades.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Trade not found' }); return; }
    trades[idx] = { ...trades[idx], ...(req.body as Partial<Trade>), id };
    account.trades = trades;
    await writeAccount(account);
    res.json(trades[idx]);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /api/trades/:id
tradesRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await getAccount();
    account.trades = (account.trades ?? []).filter(t => t.id !== id);
    await writeAccount(account);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
