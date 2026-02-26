import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { copyFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { holdingsRouter } from './routes/holdings.js';
import { strategyRouter } from './routes/strategy.js';
import { systemPromptRouter } from './routes/system-prompt.js';
import { pricesRouter } from './routes/prices.js';
import { chatRouter } from './routes/chat.js';
import { optionsRouter } from './routes/options.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

// On first run, copy *.example.* → real file so the server starts cleanly
async function bootstrapDataFiles() {
  const files = [
    ['holdings.example.json', 'holdings.json'],
    ['strategy.example.md',   'strategy.md'],
    ['system_prompt.example.md', 'system_prompt.md'],
  ] as const;

  for (const [src, dest] of files) {
    const destPath = path.join(DATA, dest);
    try {
      await access(destPath);
    } catch {
      await copyFile(path.join(DATA, src), destPath);
      console.log(`Created ${dest} from ${src}`);
    }
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/holdings', holdingsRouter);
app.use('/api/strategy', strategyRouter);
app.use('/api/system-prompt', systemPromptRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/options', optionsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

await bootstrapDataFiles();
app.listen(PORT, () => {
  console.log(`Stonks server running on http://localhost:${PORT}`);
});
