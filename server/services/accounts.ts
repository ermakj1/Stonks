import { readFile, writeFile, readdir, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ACCOUNTS_DIR = path.resolve(__dirname, '../../data/accounts');
const ACTIVE_ACCOUNT_PATH = path.resolve(__dirname, '../../data/active-account.json');

export interface AccountHoldings {
  lastUpdated: string;
  stocks: Record<string, unknown>;
  options: Record<string, unknown>;
}

export type TradeAction = 'buy' | 'sell' | 'open' | 'close' | 'expired' | 'assigned' | 'rolled';

export interface Trade {
  id: string;
  date: string;           // YYYY-MM-DD
  action: TradeAction;
  ticker: string;
  assetType: 'stock' | 'option';
  optionType?: 'call' | 'put';
  strike?: number;
  expiration?: string;    // YYYY-MM-DD
  qty: number;            // shares or contracts (always positive)
  price: number;          // per share or per contract (NOT ×100)
  notes: string;
}

export interface Account {
  id: string;
  name: string;
  holdings: AccountHoldings;
  strategy: string;
  trades?: Trade[];
}

export function getAccountsDir(): string {
  return ACCOUNTS_DIR;
}

export async function getActiveAccountId(): Promise<string> {
  try {
    const data = await readFile(ACTIVE_ACCOUNT_PATH, 'utf-8');
    return (JSON.parse(data) as { id: string }).id;
  } catch {
    return 'demo';
  }
}

export async function setActiveAccountId(id: string): Promise<void> {
  await writeFile(ACTIVE_ACCOUNT_PATH, JSON.stringify({ id }, null, 2), 'utf-8');
}

export async function readAccount(id: string): Promise<Account> {
  const filePath = path.join(ACCOUNTS_DIR, `${id}.json`);
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data) as Account;
}

export async function writeAccount(account: Account): Promise<void> {
  const filePath = path.join(ACCOUNTS_DIR, `${account.id}.json`);
  await writeFile(filePath, JSON.stringify(account, null, 2), 'utf-8');
}

export async function listAccounts(): Promise<{ id: string; name: string }[]> {
  const files = await readdir(ACCOUNTS_DIR);
  const results: { id: string; name: string }[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const data = await readFile(path.join(ACCOUNTS_DIR, file), 'utf-8');
      const { id, name } = JSON.parse(data) as Account;
      results.push({ id, name });
    } catch {
      // skip malformed files
    }
  }
  // demo first, then alpha
  return results.sort((a, b) => {
    if (a.id === 'demo') return -1;
    if (b.id === 'demo') return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function createAccount(name: string): Promise<Account> {
  const id = randomUUID();
  const account: Account = {
    id,
    name,
    holdings: {
      lastUpdated: new Date().toISOString().split('T')[0],
      stocks: {},
      options: {},
    },
    strategy: '',
  };
  await writeAccount(account);
  return account;
}

export interface OpenPositionEntry {
  ticker: string;
  assetType: 'stock' | 'option';
  optionType?: string;
  strike?: number;
  expiration?: string;
  notes: string;
  lastOpenTradeId: string;
  lots: { price: number; qty: number }[];
}

export function buildOpenPositions(trades: Trade[]): Map<string, OpenPositionEntry> {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const positions = new Map<string, OpenPositionEntry>();

  function lotKey(t: Trade): string {
    return t.assetType === 'option'
      ? `${t.ticker}-${t.optionType}-${t.strike}-${t.expiration}`
      : `${t.ticker}-stock`;
  }

  for (const t of sorted) {
    const key = lotKey(t);
    if (t.action === 'open' || (t.action === 'buy' && t.assetType === 'stock')) {
      const existing = positions.get(key) ?? { ticker: t.ticker, assetType: t.assetType, optionType: t.optionType, strike: t.strike, expiration: t.expiration, notes: '', lastOpenTradeId: '', lots: [] };
      existing.lots.push({ price: t.price, qty: t.qty });
      existing.lastOpenTradeId = t.id;
      if (t.notes) existing.notes = t.notes; // last opening trade's notes win
      positions.set(key, existing);
    } else if (t.action === 'close' || t.action === 'expired' || t.action === 'assigned' || (t.action === 'sell' && t.assetType === 'stock')) {
      const pos = positions.get(key);
      if (!pos) continue;
      let remaining = t.qty;
      while (remaining > 0 && pos.lots.length > 0) {
        const lot = pos.lots[0];
        const consumed = Math.min(remaining, lot.qty);
        lot.qty -= consumed;
        remaining -= consumed;
        if (lot.qty <= 0) pos.lots.shift();
      }
      if (pos.lots.length === 0) positions.delete(key);
    }
  }

  return positions;
}

export async function deleteAccount(id: string): Promise<void> {
  if (id === 'demo') throw new Error('Cannot delete the demo account');
  const filePath = path.join(ACCOUNTS_DIR, `${id}.json`);
  await unlink(filePath);
}
