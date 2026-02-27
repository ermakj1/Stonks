import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { copyFile, access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { holdingsRouter } from './routes/holdings.js';
import { strategyRouter } from './routes/strategy.js';
import { systemPromptRouter } from './routes/system-prompt.js';
import { pricesRouter } from './routes/prices.js';
import { chatRouter } from './routes/chat.js';
import { optionsRouter } from './routes/options.js';
import { accountsRouter } from './routes/accounts.js';
import { ACCOUNTS_DIR } from './services/accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

async function bootstrapAccounts() {
  // Ensure accounts directory exists
  let firstRun = false;
  try {
    await access(ACCOUNTS_DIR);
  } catch {
    await mkdir(ACCOUNTS_DIR, { recursive: true });
    console.log('Created data/accounts/');
    firstRun = true;
  }

  if (firstRun) {
    // Attempt to migrate existing holdings.json + strategy.md → my-portfolio account
    try {
      const holdingsRaw = await readFile(path.join(DATA, 'holdings.json'), 'utf-8');
      const strategyRaw = await readFile(path.join(DATA, 'strategy.md'), 'utf-8');
      const holdings = JSON.parse(holdingsRaw);

      const myPortfolio = {
        id: 'my-portfolio',
        name: 'My Portfolio',
        holdings,
        strategy: strategyRaw,
      };
      await writeFile(
        path.join(ACCOUNTS_DIR, 'my-portfolio.json'),
        JSON.stringify(myPortfolio, null, 2),
        'utf-8',
      );
      await writeFile(
        path.join(DATA, 'active-account.json'),
        JSON.stringify({ id: 'my-portfolio' }, null, 2),
        'utf-8',
      );
      console.log('Migrated existing holdings/strategy → My Portfolio account');
    } catch {
      // No existing files to migrate — active account defaults to demo
    }
  }

  // Always ensure demo.json exists
  const demoPath = path.join(ACCOUNTS_DIR, 'demo.json');
  try {
    await access(demoPath);
  } catch {
    const demo = {
      id: 'demo',
      name: 'Demo Portfolio',
      holdings: {
        lastUpdated: new Date().toISOString().split('T')[0],
        stocks: {
          AAPL: {
            shares: 50,
            cost_basis: 150,
            target_allocation_pct: 35,
            notes: 'Core tech position',
          },
          GOOGL: {
            shares: 20,
            cost_basis: 140,
            target_allocation_pct: 30,
            notes: 'AI and search exposure',
          },
          MSFT: {
            shares: 0,
            cost_basis: 0,
            target_allocation_pct: 0,
            notes: 'Watching for entry',
          },
        },
        options: {
          'AAPL260619C00200000': {
            ticker: 'AAPL',
            type: 'call',
            strike: 200,
            expiration: '2026-06-19',
            contracts: 2,
            premium_paid: 5.5,
            notes: 'Speculative upside play',
          },
          'GOOGL260320C00180000': {
            ticker: 'GOOGL',
            type: 'call',
            strike: 180,
            expiration: '2026-03-20',
            contracts: 0,
            premium_paid: 0,
            saved_price: 3.2,
            target_price: 6.0,
            notes: 'Watching for breakout above resistance',
          },
        },
      },
      strategy:
        '# Demo Trading Strategy\n\n## Goals\n- Demonstrate the Stonks app with sample data\n- Long-term growth in tech sector\n\n## Risk Tolerance\n- Medium: comfortable with moderate volatility\n\n## Rules\n- This is a read-only demo account\n- Switch to "My Portfolio" to manage your real holdings\n',
    };
    await writeFile(demoPath, JSON.stringify(demo, null, 2), 'utf-8');
    console.log('Created demo account');
  }

  // Bootstrap system_prompt.md (kept global)
  const systemPromptDest = path.join(DATA, 'system_prompt.md');
  try {
    await access(systemPromptDest);
  } catch {
    await copyFile(path.join(DATA, 'system_prompt.example.md'), systemPromptDest);
    console.log('Created system_prompt.md from example');
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/accounts', accountsRouter);
app.use('/api/holdings', holdingsRouter);
app.use('/api/strategy', strategyRouter);
app.use('/api/system-prompt', systemPromptRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/options', optionsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

await bootstrapAccounts();
app.listen(PORT, () => {
  console.log(`Stonks server running on http://localhost:${PORT}`);
});
