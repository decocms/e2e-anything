const USER_AGENT =
  "AIFundingScraper/1.0 (+https://github.com/ai-funding-scraper; research project)";

const DEFAULT_RATE_LIMIT_MS = 2000;

// Track last request time per domain
const domainTimestamps = new Map<string, number>();

// robots.txt cache (domain -> Set of disallowed paths)
const robotsCache = new Map<string, { disallowed: string[]; fetchedAt: number }>();
const ROBOTS_CACHE_TTL = 3600_000; // 1 hour

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/**
 * Fetch with rate limiting per domain and proper headers
 */
export async function rateLimitedFetch(
  url: string,
  options: RequestInit & { rateLimitMs?: number } = {}
): Promise<Response> {
  const domain = getDomain(url);
  const rateLimit = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  const { rateLimitMs: _, ...fetchOptions } = options;

  // Rate limit per domain
  const lastTime = domainTimestamps.get(domain) ?? 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed < rateLimit) {
    await Bun.sleep(rateLimit - elapsed);
  }

  domainTimestamps.set(domain, Date.now());

  const headers = new Headers(fetchOptions.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", USER_AGENT);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    redirect: "follow",
  });

  return response;
}

/**
 * Check robots.txt for a URL
 */
export async function isAllowedByRobotsTxt(url: string): Promise<boolean> {
  const domain = getDomain(url);

  // Check cache
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL) {
    return !isDisallowed(url, cached.disallowed);
  }

  try {
    const robotsUrl = `https://${domain}/robots.txt`;
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) {
      // No robots.txt = everything allowed
      robotsCache.set(domain, { disallowed: [], fetchedAt: Date.now() });
      return true;
    }

    const text = await res.text();
    const disallowed = parseRobotsTxt(text);
    robotsCache.set(domain, { disallowed, fetchedAt: Date.now() });
    return !isDisallowed(url, disallowed);
  } catch {
    // If we can't fetch robots.txt, assume allowed
    return true;
  }
}

function parseRobotsTxt(text: string): string[] {
  const disallowed: string[] = [];
  let inUserAgent = false;
  let isRelevant = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [key, ...valueParts] = trimmed.split(":");
    const value = valueParts.join(":").trim();

    if (key.toLowerCase() === "user-agent") {
      inUserAgent = true;
      isRelevant = value === "*" || value.toLowerCase().includes("bot");
    } else if (key.toLowerCase() === "disallow" && isRelevant && value) {
      disallowed.push(value);
    }
  }

  return disallowed;
}

function isDisallowed(url: string, disallowed: string[]): boolean {
  try {
    const path = new URL(url).pathname;
    return disallowed.some((rule) => path.startsWith(rule));
  } catch {
    return false;
  }
}

/**
 * Fetch with retry on transient failures
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { rateLimitMs?: number; maxRetries?: number } = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await rateLimitedFetch(url, options);
      if (res.status === 429) {
        // Rate limited — back off exponentially
        const backoff = Math.pow(2, attempt) * 5000;
        console.warn(`[fetch] Rate limited on ${url}, backing off ${backoff}ms`);
        await Bun.sleep(backoff);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000;
        await Bun.sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}
