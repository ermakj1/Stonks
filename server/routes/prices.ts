import { Router } from 'express';
import { getActiveAccountId, readAccount } from '../services/accounts.js';
import { getAllPrices } from '../services/yahoo.js';

export const pricesRouter = Router();

pricesRouter.get('/', async (_req, res) => {
  try {
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prices = await getAllPrices(account.holdings as any);
    res.json(prices);
  } catch (err) {
    console.error('Prices fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
