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
│   │   │   ├── Chat.tsx               # AI chat panel with SSE streaming; localStorage history per account
│   │   │   ├── ChatMessage.tsx        # Message rendering, FILE_UPDATE, OPTION_SUGGESTION parsing
│   │   │   ├── HoldingsPanel.tsx      # Stocks + options tables (AG Grid); dividend columns; target income
│   │   │   ├── DashboardPanel.tsx     # Portfolio overview, P&L chart, dividend income breakdown
│   │   │   ├── TradesPanel.tsx        # Trade log, FIFO P&L, charts, broker import (Fidelity/Schwab)
│   │   │   ├── PnLChart.tsx           # Recharts cumulative P&L chart
│   │   │   ├── StrategyPanel.tsx      # Strategy markdown editor
│   │   │   ├── SettingsBar.tsx        # Account switcher, AI model/provider selector
│   │   │   ├── OptionChainModal.tsx   # Inline option chain viewer with monthly/weekly/daily filter
│   │   │   ├── DebugPanel.tsx         # AI context inspector (system prompt viewer)
│   │   │   └── FileDiffModal.tsx      # Before/after diff for AI file updates
│   │   ├── hooks/
│   │   │   └── useOptionChain.ts      # Option chain data, caching, expiry classification
│   │   └── utils/
│   │       └── blackScholes.ts        # Black-Scholes delta calculation (client-side)
├── server/                    # Backend (Express + TypeScript, ESM)
│   ├── index.ts               # App entry point, route registration, account bootstrap
│   ├── routes/
│   │   ├── accounts.ts        # GET/POST/PATCH/DELETE /api/accounts
│   │   ├── chat.ts            # POST /api/chat — AI streaming; GET /api/chat/context
│   │   ├── holdings.ts        # GET/PUT /api/holdings
│   │   ├── strategy.ts        # GET/PUT /api/strategy
│   │   ├── prices.ts          # GET /api/prices
│   │   ├── trades.ts          # CRUD /api/trades, POST /api/trades/bulk
│   │   ├── positions.ts       # GET /api/positions/unrealized
│   │   └── options.ts         # GET /api/options/:ticker — option chain for modal
│   └── services/
│       ├── accounts.ts        # Account file I/O; buildOpenPositions() FIFO engine
│       ├── ai.ts              # SSE streaming for Anthropic + Gemini; get_option_chain tool
│       ├── yahoo.ts           # Yahoo Finance v8 API (quotes, HV30, dividend data)
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
  ├── fetches       Yahoo Finance v8 API (stock prices, HV30, dividends)
  ├── fetches       CBOE CDN (option bid/ask/IV/delta, 5-min cache)
  └── streams       Anthropic / Gemini API (SSE → browser)
```

## Account Schema

```json
{
  "id": "my-portfolio",
  "name": "My Portfolio",
  "holdings": {
    "lastUpdated": "2026-04-22",
    "stocks": {
      "AAPL": { "shares": 50, "cost_basis": 150, "target_allocation_pct": 35, "notes": "" }
    },
    "options": {}
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

- `holdings.options` is now effectively empty `{}` — options are tracked via `trades[]`
- `contracts > 0` = long option (bought); `contracts < 0` = short (sold to open); `contracts === 0` = watchlist
- Trade `action = "open"` = sell to open; `action = "close"` = buy to close
- Open positions are derived live via `buildOpenPositions(trades)` in `accounts.ts`

## Trade P&L (FIFO)

The trade history uses FIFO lot matching for P&L calculation:

1. Trades are sorted chronologically
2. `open`/`buy` actions push lots onto a per-contract queue
3. `close`/`sell`/`expired`/`assigned` actions consume from the front (FIFO)
4. Partial fills are handled by fractional lot consumption
5. P&L for short options: `(openPrice - closePrice) × qty × 100`
6. P&L for stocks: `(sellPrice - buyPrice) × qty`

`buildOpenPositions()` (shared between positions route and AI chat) returns a Map of currently open lots with avg cost basis and notes from the opening trade.

## Trade Import

`TradesPanel` supports two paste formats, auto-detected:

- **Fidelity/Schwab web** — 5 or 6 line blocks per trade (date / [account] / action / details / filled price / total). Detected by presence of `"Filled at $"`.
- **Tab-separated CSV** — 10+ column export format (symbol, price, qty, commission, fees, amount, settlement date).

## AI System Prompt

Built per-request in `server/routes/chat.ts`:

1. Persona (from `data/system_prompt.md`)
2. Trading strategy (from account)
3. Current holdings — stocks (owned + watchlist) + options (owned + watchlist) with live prices
4. Open positions from trade history with live CBOE mid prices and "Strategic intent" notes
5. Recent trade history (optional toggle)
6. Tool use instructions (`get_option_chain`)
7. FILE_UPDATE and OPTION_SUGGESTION format rules

Chat history is persisted per account in `localStorage` (up to 200 messages). Last 20 messages are sent to the AI per request.

## AI Tool: get_option_chain

The AI can call `get_option_chain` to fetch live option data mid-conversation:

- Parameters: `ticker` (required), `type` ("calls" or "puts", required), `dte_min`, `dte_max`, `otm_only`, `max_results` (up to 120)
- Calls `getFilteredChain()` in `cboe.ts`
- OTM chains split calls/puts per expiry and sort by strike direction so far-OTM strikes are always included
- Returns formatted table with strike, expiry, DTE, bid/ask/mid, IV%, delta, volume, OI

## AI Streaming Protocol

Chat messages are sent to `POST /api/chat`. The server responds with SSE:

```
data: {"text": "Hello"}
data: {"tool_call": {"name": "get_option_chain", "input": {...}}}
data: [DONE]
```

The client accumulates text deltas. After streaming completes, scans for:

- `<<<FILE_UPDATE>>>...<<<END_FILE_UPDATE>>>` — AI-suggested holdings or strategy changes. Shown in a diff modal before applying.
- `<<<OPTION_SUGGESTION>>>...<<<END_OPTION_SUGGESTION>>>` — JSON option contract suggestions. Rendered as "Add to Watchlist" buttons and auto-opens the option chain modal.

## Market Data

### Yahoo Finance (stocks)
- Endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}`
- No auth required
- Used for: current price, change%, volume, market cap, HV30 (30-day historical volatility), trailing annual dividend rate and yield

### CBOE CDN (options)
- Endpoint: `https://cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json`
- Free, no auth, ~15 minute delay
- Returns full option chain with bid/ask/IV/delta/OI/volume
- Cached in-process per ticker for 5 minutes

## Dividend Tracking

`yahoo.ts` fetches dividend events from the v8 chart API (`?events=dividends&range=1y`) and computes:
- `dividendRate` — trailing annual $ per share (sum of dividends in last 365 days)
- `dividendYield` — rate / current price
- `exDividendDate` — most recent ex-div date

These flow into HoldingsPanel (`Div Yield %`, `Ann. Income $`, `Target Income` columns) and DashboardPanel (projected income stat card and breakdown table).

## Expiry Classification

`useOptionChain.ts` classifies option expiry dates:
- **Monthly** — third Friday of month (date 15–21) OR Thursday date 14–20 when the following Friday is a US market holiday (e.g. Jun 18 2026 when Jun 19 = Juneteenth)
- **Weekly** — any other Friday
- **Daily** — Mon–Thu that isn't a holiday-shifted monthly

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

AI clients (Anthropic, Gemini) are instantiated lazily via getter functions to avoid top-level instantiation before `dotenv` runs.
