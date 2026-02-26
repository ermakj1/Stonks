# Stonks

A local AI-powered stock trading assistant. Combines live market data with an AI chat interface that has full context of your holdings, strategy, and live prices — and can suggest updates to both.

![Dark theme UI with holdings panel and AI chat](https://placehold.co/900x500/0f172a/34d399?text=Stonks)

## Features

- **Holdings panel** — live stock prices, day change %, P&L, target vs actual allocation. Inline-editable via double-click.
- **Options tracking** — owned options with cost basis, current mid price (CBOE), and gain/loss %. Watchlist with saved and target mid prices.
- **Option chain modal** — full CBOE chain with multi-expiry selection, daily/weekly/monthly frequency filter, delta/IV/bid/ask, and one-click watchlist add.
- **AI chat** — streaming responses from Claude (Anthropic) or Gemini (Google). The AI sees your full holdings, live prices, and strategy on every message.
- **File update protocol** — the AI can propose changes to your holdings or strategy; you review a diff and approve or reject before anything is saved.
- **Strategy editor** — edit your trading strategy in Markdown with ⌘S save.
- **System prompt editor** — customize the AI's personality and standing instructions.
- **No AI mode** — use the holdings and options tools without any AI provider selected. No API credits consumed.
- **Resizable split pane**, fully dark-themed UI.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Data grid | AG Grid v35 Community |
| Backend | Node.js + Express + TypeScript (`tsx` in dev) |
| Market data | Yahoo Finance (stocks) + CBOE CDN (options, ~15 min delay) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) or Google Gemini (`gemini-2.0-flash`) |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add at least one API key:

```env
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
AI_PROVIDER=anthropic   # default provider shown in UI
PORT=3001
```

Both keys are optional — if you only have one, select the matching provider in the UI (or select **No AI** to use the app without any AI).

### 3. Run

```bash
npm run dev
```

This starts the Express server on `:3001` and Vite on `:5173`. Open [http://localhost:5173](http://localhost:5173).

On first run the server automatically copies the `data/*.example.*` template files to create your personal data files.

## Data Files

Your personal data lives in `data/` and is gitignored — it never leaves your machine.

| File | Purpose | Edited via |
|------|---------|------------|
| `data/holdings.json` | Stock and options positions | Holdings panel (inline) or AI |
| `data/strategy.md` | Trading strategy in Markdown | Strategy tab or AI |
| `data/system_prompt.md` | AI persona and standing instructions | System Prompt tab |

Template versions (`*.example.*`) are committed to the repo and used to seed your local files on first start.

## Project Structure

```
├── client/src/
│   ├── App.tsx
│   ├── components/
│   │   ├── Chat.tsx              # Streaming AI chat
│   │   ├── FileDiffModal.tsx     # Approve/reject AI-proposed file changes
│   │   ├── HoldingsPanel.tsx     # Stocks + options grids
│   │   ├── OptionChainModal.tsx  # Full options chain browser
│   │   ├── SettingsBar.tsx       # Provider selector + refresh
│   │   └── StrategyPanel.tsx     # Markdown editor (strategy & system prompt)
│   └── hooks/
│       └── useOptionChain.ts     # Option chain state, filtering, per-expiry cache
├── server/
│   ├── index.ts                  # Express entry point + data file bootstrap
│   ├── routes/                   # chat, holdings, strategy, system-prompt, prices, options
│   └── services/
│       ├── ai.ts                 # Anthropic + Gemini SSE streaming abstraction
│       ├── cboe.ts               # CBOE CDN option chain fetcher (5-min cache)
│       └── yahoo.ts              # Yahoo Finance stock quotes
└── data/
    ├── *.example.*               # Committed templates
    └── *.json / *.md             # Your personal data (gitignored)
```

## Scripts

```bash
npm run dev      # Dev server (tsx watch + vite)
npm run build    # Production build
npm run start    # Run production build
```

## Notes

- Option data is sourced from the CBOE delayed quotes CDN — free, no API key required, approximately 15-minute delay.
- No data is sent to any external service other than the AI provider you select. Stock/options data is fetched directly from Yahoo Finance and CBOE.
- The AI provider can be changed at any time from the top bar. Selecting **No AI** ensures zero API usage.
