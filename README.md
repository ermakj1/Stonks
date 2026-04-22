# Stonks

AI-powered stock and options trading assistant — a local web app combining live market data with Claude or Gemini AI chat.

## Features

- **AI Chat** — Chat with Claude or Gemini about your portfolio. The AI sees your holdings, live prices, open positions, trading strategy, and trade history. Suggests option contracts with one-click "Add to Watchlist" buttons. Conversation history persists per account across sessions.
- **Dashboard** — Portfolio overview with stock value, today's change, realized P&L, unrealized options P&L, and projected annual dividend income. Includes allocation chart, dividend income breakdown, and recent trade log.
- **Holdings Panel** — Track stocks with live prices from Yahoo Finance. Inline editing for cost basis, target allocation %, target $, target income, and notes. Dividend yield and annual income columns. Options positions derived automatically from trade history.
- **Option Watchlist** — Watch option chains without owning the contracts. Filter by expiry frequency (monthly/weekly/daily), view live bid/ask/IV.
- **Option Chain** — Inline option chain modal with expiry filtering, live CBOE data, and direct add-to-watchlist. AI can fetch the chain mid-conversation to find specific strikes.
- **Trade History** — Log trades manually or import from Fidelity/Schwab (web copy-paste block format or tab-separated CSV export). Open and closed positions in separate sections. FIFO P&L, cumulative P&L chart, win rate stats, CSV export.
- **Strategy Editor** — Edit your trading strategy in markdown. The AI uses this as context for every chat message.
- **Multi-Account** — Switch between multiple portfolios. Includes a read-only Demo account.
- **File Updates** — The AI can suggest changes to your holdings or strategy, which you can review and apply via a diff modal.

## Requirements

- Node.js 20+
- npm
- An Anthropic API key and/or Google Gemini API key

## Setup

```bash
# 1. Clone and install
git clone https://github.com/ermakj1/Stonks.git
cd Stonks
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your API keys

# 3. Start the development server
npm run dev
```

The app will be available at **http://localhost:5173**. The API runs on port 3001.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | — |
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `AI_PROVIDER` | Default AI provider (`anthropic` or `gemini`) | `anthropic` |
| `PORT` | Backend server port | `3001` |

## Data

- Account data is stored in `data/accounts/{id}.json`
- The active account is tracked in `data/active-account.json`
- A global AI persona can be edited at `data/system_prompt.md`
- On first run, existing `data/holdings.json` and `data/strategy.md` are migrated to a "My Portfolio" account

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed technical overview.
