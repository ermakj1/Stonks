import { Router } from 'express';
import {
  listAccounts,
  getActiveAccountId,
  setActiveAccountId,
  readAccount,
  createAccount,
  deleteAccount,
  writeAccount,
} from '../services/accounts.js';

export const accountsRouter = Router();

// GET /api/accounts
accountsRouter.get('/', async (_req, res) => {
  try {
    res.json(await listAccounts());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

// GET /api/accounts/active
accountsRouter.get('/active', async (_req, res) => {
  try {
    const id = await getActiveAccountId();
    const account = await readAccount(id);
    res.json({ id, account });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get active account' });
  }
});

// PUT /api/accounts/active
accountsRouter.put('/active', async (req, res) => {
  try {
    const { id } = req.body as { id: string };
    if (!id) {
      res.status(400).json({ error: 'id required' });
      return;
    }
    await setActiveAccountId(id);
    const account = await readAccount(id);
    res.json({ id, account });
  } catch (err) {
    res.status(500).json({ error: 'Failed to switch account' });
  }
});

// POST /api/accounts
accountsRouter.post('/', async (req, res) => {
  try {
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name required' });
      return;
    }
    const account = await createAccount(name.trim());
    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// PATCH /api/accounts/:id — rename
accountsRouter.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body as { name: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name required' });
      return;
    }
    const account = await readAccount(id);
    account.name = name.trim();
    await writeAccount(account);
    res.json({ id: account.id, name: account.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename account' });
  }
});

// DELETE /api/accounts/:id
accountsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteAccount(id);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('demo') ? 403 : 500).json({ error: msg });
  }
});
