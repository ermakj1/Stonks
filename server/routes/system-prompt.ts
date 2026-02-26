import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, '../../data/system_prompt.md');

export const systemPromptRouter = Router();

systemPromptRouter.get('/', async (_req, res) => {
  try {
    const data = await readFile(SYSTEM_PROMPT_PATH, 'utf-8');
    res.json({ content: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read system prompt' });
  }
});

systemPromptRouter.put('/', async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    await writeFile(SYSTEM_PROMPT_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write system prompt' });
  }
});
