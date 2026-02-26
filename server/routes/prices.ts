import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllPrices } from '../services/yahoo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOLDINGS_PATH = path.resolve(__dirname, '../../data/holdings.json');

export const pricesRouter = Router();

pricesRouter.get('/', async (_req, res) => {
  try {
    const raw = await readFile(HOLDINGS_PATH, 'utf-8');
    const holdings = JSON.parse(raw);
    const prices = await getAllPrices(holdings);
    res.json(prices);
  } catch (err) {
    console.error('Prices fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
