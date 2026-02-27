import { Router } from 'express';
import { getActiveAccountId, readAccount, writeAccount } from '../services/accounts.js';
import { getOptionMid } from '../services/cboe.js';

export const holdingsRouter = Router();

holdingsRouter.get('/', async (_req, res) => {
  try {
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    res.json(account.holdings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read holdings' });
  }
});

holdingsRouter.put('/', async (req, res) => {
  try {
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    const content = req.body;
    content.lastUpdated = new Date().toISOString().split('T')[0];
    account.holdings = content;
    await writeAccount(account);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write holdings' });
  }
});

holdingsRouter.post('/watch-option', async (req, res) => {
  try {
    const { ticker, type, strike, expiration, notes = '' } = req.body as {
      ticker: string; type: string; strike: number; expiration: string; notes?: string;
    };

    if (!ticker || !type || !strike || !expiration) {
      res.status(400).json({ error: 'ticker, type, strike, expiration required' });
      return;
    }

    // Build OCC key: TICKER + YYMMDD + C/P + strike*1000 padded to 8 digits
    const [yyyy, mm, dd] = expiration.split('-');
    const yy = yyyy.slice(2);
    const cp = type.toLowerCase() === 'call' ? 'C' : 'P';
    const strikeStr = Math.round(strike * 1000).toString().padStart(8, '0');
    const occKey = `${ticker.toUpperCase()}${yy}${mm}${dd}${cp}${strikeStr}`;

    // Fetch current mid price from CBOE (best-effort)
    const mid = await getOptionMid(ticker.toUpperCase(), type, strike, expiration);

    const id = await getActiveAccountId();
    const account = await readAccount(id);
    const holdings = account.holdings as {
      stocks: Record<string, unknown>;
      options: Record<string, unknown>;
      lastUpdated: string;
    };

    holdings.options[occKey] = {
      ticker: ticker.toUpperCase(),
      type: type.toLowerCase(),
      strike,
      expiration,
      contracts: 0,
      premium_paid: 0,
      saved_price: mid?.mid ?? null,
      target_price: 0,
      notes,
    };
    holdings.lastUpdated = new Date().toISOString().split('T')[0];

    account.holdings = holdings;
    await writeAccount(account);
    res.json({ success: true, occKey, mid: mid?.mid ?? null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add option to watchlist' });
  }
});
