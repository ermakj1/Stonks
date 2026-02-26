/**
 * Yahoo Finance crumb + cookie caching — kept for potential future use.
 * Options chain now uses Polygon.io instead (no crumb needed).
 */

const HEADERS_BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

let cachedCrumb: string | null = null;
let cachedCookie: string | null = null;
let lastFetch = 0;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && now - lastFetch < TTL_MS) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }

  try {
    // Step 1: hit Yahoo Finance to get consent cookies
    const pageRes = await fetch('https://finance.yahoo.com/', {
      headers: HEADERS_BROWSER,
      redirect: 'follow',
    });

    const setCookieHeaders = pageRes.headers.getSetCookie?.() ?? [];
    // Combine all cookies
    const cookie = setCookieHeaders.map(c => c.split(';')[0]).join('; ');

    if (!cookie) {
      console.warn('No cookies received from Yahoo Finance');
      return null;
    }

    // Step 2: fetch the crumb using the cookies we just got
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        ...HEADERS_BROWSER,
        'Cookie': cookie,
      },
    });

    if (!crumbRes.ok) {
      console.warn(`Crumb fetch failed: ${crumbRes.status}`);
      return null;
    }

    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<')) {
      console.warn('Got HTML instead of crumb — Yahoo consent wall');
      return null;
    }

    cachedCrumb = crumb.trim();
    cachedCookie = cookie;
    lastFetch = now;

    console.log('Yahoo crumb obtained successfully');
    return { crumb: cachedCrumb, cookie: cachedCookie };
  } catch (err) {
    console.error('Crumb fetch error:', err);
    return null;
  }
}

export function invalidateCrumb() {
  cachedCrumb = null;
  cachedCookie = null;
  lastFetch = 0;
}
