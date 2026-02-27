import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOptionMid } from '../services/cboe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOLDINGS_PATH = path.resolve(__dirname, '../../data/holdings.json');

export const holdingsRouter = Router();

holdingsRouter.get('/', async (_req, res) => {
  try {
    const data = await readFile(HOLDINGS_PATH, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read holdings' });
  }
});

holdingsRouter.put('/', async (req, res) => {
  try {
    const content = req.body;
    content.lastUpdated = new Date().toISOString().split('T')[0];
    await writeFile(HOLDINGS_PATH, JSON.stringify(content, null, 2), 'utf-8');
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

    const data = await readFile(HOLDINGS_PATH, 'utf-8');
    const holdings = JSON.parse(data);

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

    await writeFile(HOLDINGS_PATH, JSON.stringify(holdings, null, 2), 'utf-8');
    res.json({ success: true, occKey, mid: mid?.mid ?? null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add option to watchlist' });
  }
});
