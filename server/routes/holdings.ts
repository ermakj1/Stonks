import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
