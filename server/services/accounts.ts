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

export interface Account {
  id: string;
  name: string;
  holdings: AccountHoldings;
  strategy: string;
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

export async function deleteAccount(id: string): Promise<void> {
  if (id === 'demo') throw new Error('Cannot delete the demo account');
  const filePath = path.join(ACCOUNTS_DIR, `${id}.json`);
  await unlink(filePath);
}
