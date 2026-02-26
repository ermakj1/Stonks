import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGY_PATH = path.resolve(__dirname, '../../data/strategy.md');

export const strategyRouter = Router();

strategyRouter.get('/', async (_req, res) => {
  try {
    const data = await readFile(STRATEGY_PATH, 'utf-8');
    res.json({ content: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read strategy' });
  }
});

strategyRouter.put('/', async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    await writeFile(STRATEGY_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write strategy' });
  }
});
