import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getActiveAccountId, readAccount, writeAccount, type Trade } from '../services/accounts.js';

export const tradesRouter = Router();

async function getAccount() {
  const id = await getActiveAccountId();
  return readAccount(id);
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
