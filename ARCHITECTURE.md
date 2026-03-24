# Architecture

## Overview

Stonks is a local single-user web application. It has two processes:

- **Frontend** — Vite + React + TypeScript on port 5173. Proxies `/api/*` to the backend.
- **Backend** — Express + TypeScript on port 3001. Handles data persistence, market data fetching, and AI streaming.

## Directory Structure

```
stonks/
├── client/                    # Frontend (Vite + React)
│   ├── index.html
│   ├── vite.config.ts         # Proxies /api → localhost:3001
│   ├── src/
│   │   ├── App.tsx            # Root layout, tab switching, account state
│   │   ├── types.ts           # Shared TypeScript interfaces
│   │   ├── components/
│   │   │   ├── Chat.tsx               # AI chat panel with SSE streaming
│   │   │   ├── ChatMessage.tsx        # Message rendering, FILE_UPDATE, OPTION_SUGGESTION parsing
│   │   │   ├── HoldingsPanel.tsx      # Stocks + options tables (AG Grid)
│   │   │   ├── TradesPanel.tsx        # Trade log, FIFO P&L, charts, import
│   │   │   ├── PnLChart.tsx           # Recharts cumulative P&L chart
│   │   │   ├── StrategyPanel.tsx      # Strategy markdown editor
│   │   │   ├── SettingsBar.tsx        # Account switcher, AI model selector
│   │   │   ├── OptionChainModal.tsx   # Inline option chain viewer
│   │   │   └── FileDiffModal.tsx      # Before/after diff for AI file updates
│   │   └── hooks/
│   │       └── useOptionChain.ts      # Option chain data + caching
├── server/                    # Backend (Express + TypeScript, ESM)
│   ├── index.ts               # App entry point, route registration, account bootstrap
│   ├── routes/
│   │   ├── accounts.ts        # GET/POST/PATCH/DELETE /api/accounts
│   │   ├── chat.ts            # POST /api/chat — AI streaming; GET /api/chat/context
│   │   ├── holdings.ts        # GET/PUT /api/holdings
│   │   ├── strategy.ts        # GET/PUT /api/strategy
│   │   ├── prices.ts          # GET /api/prices
│   │   ├── trades.ts          # CRUD /api/trades
│   │   ├── positions.ts       # GET /api/positions/unrealized
│   │   └── options.ts         # GET /api/options/:ticker — option chain
│   └── services/
│       ├── accounts.ts        # Account file I/O helpers
│       ├── ai.ts              # SSE streaming for Anthropic + Gemini
│       ├── yahoo.ts           # Yahoo Finance v8 API (stock quotes, HV30)
│       └── cboe.ts            # CBOE CDN option data (free, ~15min delay, 5min cache)
├── data/
│   ├── accounts/              # Per-account JSON files
│   │   ├── demo.json          # Read-only demo account
│   │   └── {id}.json          # User accounts
│   ├── active-account.json    # { "id": "..." }
│   ├── system_prompt.md       # Global AI persona (editable in Settings)
│   └── system_prompt.example.md
├── tailwind.config.js         # Must be at project ROOT (not client/)
├── postcss.config.js          # Must be at project ROOT (not client/)
└── package.json               # ESM ("type": "module"), concurrently dev script
```

## Data Flow

```
Browser (React)
  ↕  HTTP / SSE
Vite dev server :5173
  ↕  proxied /api/* requests
Express server :3001
  ├── reads/writes  data/accounts/{id}.json
  ├── fetches       Yahoo Finance v8 API (stock prices, HV30)
  ├── fetches       CBOE CDN (option bid/ask/IV, 5-min cache)
  └── streams       Anthropic / Gemini API (SSE → browser)
```

## Account Schema

```json
{
  "id": "my-portfolio",
  "name": "My Portfolio",
  "holdings": {
    "lastUpdated": "2026-03-24",
    "stocks": {
      "AAPL": { "shares": 50, "cost_basis": 150, "target_allocation_pct": 35, "notes": "" }
    },
    "options": {
      "AAPL260619C00200000": {
        "ticker": "AAPL", "type": "call", "strike": 200, "expiration": "2026-06-19",
        "contracts": -2, "premium_paid": 5.50, "notes": ""
      }
    }
  },
  "strategy": "# My Strategy\n...",
  "trades": [
    {
      "id": "uuid", "date": "2026-03-01", "action": "open",
      "ticker": "AAPL", "assetType": "option", "optionType": "call",
      "strike": 200, "expiration": "2026-06-19",
      "qty": 2, "price": 5.50, "notes": ""
    }
  ]
}
```

### Options conventions

- `contracts > 0` = long option (bought)
- `contracts < 0` = short option (sold to open)
- `contracts === 0` = watchlist entry only
- Trade `action = "open"` = sell to open (premium received = inflow)
- Trade `action = "close"` = buy to close (premium paid = outflow)

## Trade P&L (FIFO)

The trade history uses FIFO lot matching for P&L calculation:

1. Trades are sorted chronologically
2. `open`/`buy` actions push lots onto a per-contract queue
3. `close`/`sell`/`expired`/`assigned` actions consume from the front (FIFO)
4. Partial fills are handled by fractional lot consumption
5. P&L for short options: `(openPrice - closePrice) × qty × 100`
6. P&L for stocks: `(sellPrice - buyPrice) × qty`

## AI Streaming Protocol

Chat messages are sent to `POST /api/chat`. The server responds with SSE:

```
data: {"type":"text","delta":"Hello"}
data: {"type":"text","delta":" world"}
data: [DONE]
```

The client accumulates deltas into a single message string. After streaming completes, the client scans the message for:

- `<<<FILE_UPDATE>>>...<<<END_FILE_UPDATE>>>` — AI-suggested holdings or strategy changes. Shown in a diff modal before applying.
- `<<<OPTION_SUGGESTION>>>...<<<END_OPTION_SUGGESTION>>>` — JSON option contract suggestions. Rendered as "Add to Watchlist" buttons.

## Market Data

### Yahoo Finance (stocks)
- Endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}`
- No auth required
- Used for: current price, change%, volume, HV30 calculation

### CBOE CDN (options)
- Endpoint: `https://cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json`
- Free, no auth, ~15 minute delay
- Returns full option chain with bid/ask/IV/delta/OI/volume
- Cached in-process per ticker for 5 minutes

## Tailwind Config

Vite is invoked from the **project root** (not `client/`), so Tailwind's content scanner resolves paths relative to the root. The working config files must be at:

- `/tailwind.config.js` — `content: ['./client/index.html', './client/src/**/*.{js,ts,jsx,tsx}']`
- `/postcss.config.js`

The files in `client/tailwind.config.js` and `client/postcss.config.js` exist but are ignored at runtime.

## ESM Notes

The server uses Node ESM (`"type": "module"` in package.json). Key patterns:

```typescript
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

All internal imports must use `.js` extension even for `.ts` source files (TypeScript + Node ESM convention).
