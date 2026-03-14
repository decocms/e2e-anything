import type { SourceAdapter, ScrapedFundingRound } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parseRSS, stripHtml } from "../lib/xml-parser";
import { parseFundingTitle, extractRoundFromText, extractAmountFromText } from "../lib/title-parser";

/**
 * Massive multi-source news RSS adapter.
 *
 * Google News RSS limits each query to ~70 results. To get 90 days of coverage,
 * we split into WEEKLY time windows and use many keyword variations.
 * This gives us 12 weeks × multiple queries = hundreds of results.
 */

// ─── Static RSS feeds ───────────────────────────────────────────
const STATIC_FEEDS = [
  "https://venturebeat.com/category/ai/feed/",
  "https://venturebeat.com/category/business/feed/",
  "https://siliconangle.com/category/ai/feed/",
  "https://www.artificialintelligence-news.com/feed/",
  "https://techfundingnews.com/feed/",
  "https://www.eu-startups.com/feed/",
];

// ─── Google News query templates ────────────────────────────────
// Each gets combined with time windows for full 90-day coverage

const GOOGLE_NEWS_QUERIES = [
  // Direct funding queries
  'AI startup "Series A" raises',
  'AI startup "Series B" raises',
  'AI startup "Series C" raises',
  'AI startup "Series D" raises',
  'AI startup "Series E" raises',
  'AI company raises million "Series A"',
  'AI company raises million "Series B"',
  'AI company raises million "Series C"',
  'artificial intelligence startup funding round million',
  'AI startup secures funding million',
  'generative AI startup raises',
  'AI startup closes funding round',
  'machine learning startup raises Series',
  // Regional coverage
  'AI startup raises million Europe',
  'AI startup raises million Asia',
  'AI startup raises million India',
  'AI startup raises million Israel',
  'AI startup raises million UK',
  'AI startup raises million Canada',
  'AI startup raises million Latin America',
  // Sector-specific AI
  'AI healthcare startup raises Series',
  'AI cybersecurity startup raises Series',
  'AI fintech startup raises',
  'AI defense startup raises',
  'robotics startup raises Series',
  'autonomous startup raises Series',
  'AI infrastructure startup raises',
  'LLM startup raises Series',
  'AI agent startup raises',
  'computer vision startup raises Series',
];

function buildGoogleNewsUrl(query: string, afterDate?: string, beforeDate?: string): string {
  let q = encodeURIComponent(query);
  if (afterDate && beforeDate) {
    q += encodeURIComponent(` after:${afterDate} before:${beforeDate}`);
  } else {
    q += encodeURIComponent(" when:3m");
  }
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Generate weekly time windows covering the last 90 days
 */
function getWeeklyWindows(): { after: string; before: string }[] {
  const windows: { after: string; before: string }[] = [];
  const now = new Date();

  for (let weekOffset = 0; weekOffset < 13; weekOffset++) {
    const before = new Date(now);
    before.setDate(before.getDate() - weekOffset * 7);
    const after = new Date(before);
    after.setDate(after.getDate() - 7);

    windows.push({
      after: after.toISOString().split("T")[0],
      before: before.toISOString().split("T")[0],
    });
  }

  return windows;
}

export class NewsRSSAdapter implements SourceAdapter {
  readonly name = "news-rss";
  readonly displayName = "News RSS Aggregator";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];
    const seenTitles = new Set<string>();

    // 1. Static RSS feeds
    for (const feedUrl of STATIC_FEEDS) {
      try {
        const feedName = new URL(feedUrl).hostname;
        console.log(`  [${this.name}] Fetching ${feedName}...`);
        const feedResults = await this.scrapeFeed(feedUrl, seenTitles);
        results.push(...feedResults);
        console.log(`  [${this.name}] ${feedName}: ${feedResults.length} funding items`);
      } catch (err) {
        console.warn(`  [${this.name}] Error with static feed:`, (err as Error).message);
      }
    }

    // 2. Google News — time-windowed queries for broad coverage
    const windows = getWeeklyWindows();
    // Use a subset of queries per window to keep it reasonable (~100 requests total)
    // Prioritize the most productive queries for weekly scanning
    const weeklyQueries = GOOGLE_NEWS_QUERIES.slice(0, 12); // Core queries for weekly
    const monthlyQueries = GOOGLE_NEWS_QUERIES.slice(12);    // Supplementary queries monthly

    let googleTotal = 0;

    // Weekly queries across all 13 weeks
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      // For recent weeks, use all core queries. For older weeks, use fewer.
      const queries = i < 4 ? weeklyQueries : weeklyQueries.slice(0, 6);

      for (const query of queries) {
        try {
          const url = buildGoogleNewsUrl(query, w.after, w.before);
          const feedResults = await this.scrapeFeed(url, seenTitles);
          googleTotal += feedResults.length;
          results.push(...feedResults);
        } catch {
          // Silently continue on individual query failure
        }
      }
      if (i % 3 === 0) {
        console.log(`  [${this.name}] Google News week ${i + 1}/13: ${googleTotal} items so far...`);
      }
    }

    // Monthly supplementary queries (just last 3 months overall)
    for (const query of monthlyQueries) {
      try {
        const url = buildGoogleNewsUrl(query);
        const feedResults = await this.scrapeFeed(url, seenTitles);
        googleTotal += feedResults.length;
        results.push(...feedResults);
      } catch {
        // Continue
      }
    }

    console.log(`  [${this.name}] Google News total: ${googleTotal} funding items`);
    console.log(`  [${this.name}] Grand total: ${results.length} funding items`);

    return results;
  }

  private async scrapeFeed(
    feedUrl: string,
    seenTitles: Set<string>
  ): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    const res = await fetchWithRetry(feedUrl, { rateLimitMs: 800 });
    if (!res.ok) return results;

    const xml = await res.text();
    const parsedFeed = parseRSS(xml);

    for (const item of parsedFeed.items) {
      // Dedup by title
      const titleKey = item.title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      // Quick pre-filter: only process items mentioning funding keywords
      const titleLower = item.title.toLowerCase();
      const hasFundingKeyword =
        titleLower.includes("raise") ||
        titleLower.includes("series") ||
        titleLower.includes("funding") ||
        titleLower.includes("secure") ||
        titleLower.includes("close") ||
        titleLower.includes("land") ||
        titleLower.includes("million") ||
        titleLower.includes("billion") ||
        titleLower.includes("$");

      if (!hasFundingKeyword) continue;

      const parsed = parseFundingTitle(item.title);
      if (!parsed) continue;

      const descText = stripHtml(item.description || item.contentEncoded || "");

      let roundType = parsed.roundType;
      if (!roundType) roundType = extractRoundFromText(descText);
      if (!roundType) roundType = extractRoundFromText(item.title);
      if (!roundType) continue;

      let amount = parsed.amount;
      if (!amount) amount = extractAmountFromText(descText);

      const link = item.link || item.guid || "";

      results.push({
        company: {
          name: parsed.companyName,
          description: descText.slice(0, 500) || null,
          sectors: this.guessSectors(item.title, descText),
        },
        roundType,
        amountRaw: amount,
        announcedDate: item.pubDate || new Date().toISOString(),
        investors: parsed.investors,
        leadInvestors: parsed.investors,
        sourceUrl: link,
      });
    }

    return results;
  }

  private guessSectors(title: string, desc: string): string[] {
    const text = `${title} ${desc}`.toLowerCase();
    const sectors: string[] = [];

    const sectorMap: Record<string, string> = {
      "artificial intelligence": "Artificial Intelligence",
      "machine learning": "Machine Learning",
      "generative ai": "Generative AI",
      "cybersecurity": "Cybersecurity",
      "fintech": "Fintech",
      "healthtech": "Healthtech",
      "health tech": "Healthtech",
      "healthcare": "Healthcare",
      "biotech": "Biotech",
      "edtech": "Edtech",
      "climate tech": "Climate Tech",
      "cleantech": "Climate Tech",
      "saas": "SaaS",
      "enterprise": "Enterprise",
      "robotics": "Robotics",
      "autonomous": "Autonomous Systems",
      "developer tools": "Developer Tools",
      "devtools": "Developer Tools",
      "infrastructure": "Infrastructure",
      "cloud": "Cloud",
      "defense": "Defense",
      "space": "Space",
      "computer vision": "Computer Vision",
      "natural language": "NLP",
      "drug discovery": "Drug Discovery",
    };

    for (const [keyword, sector] of Object.entries(sectorMap)) {
      if (text.includes(keyword)) sectors.push(sector);
    }

    return [...new Set(sectors)];
  }
}
