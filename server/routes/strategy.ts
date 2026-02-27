import { Router } from 'express';
import { getActiveAccountId, readAccount, writeAccount } from '../services/accounts.js';

export const strategyRouter = Router();

strategyRouter.get('/', async (_req, res) => {
  try {
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    res.json({ content: account.strategy });
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
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    account.strategy = content;
    await writeAccount(account);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write strategy' });
  }
});
