import type { SourceAdapter, ScrapedFundingRound } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parseRSS, stripHtml } from "../lib/xml-parser";
import { parseFundingTitle, extractRoundFromText, extractAmountFromText } from "../lib/title-parser";

const FEED_URLS = [
  "https://techcrunch.com/category/fundraising/feed/",
  "https://techcrunch.com/tag/funding/feed/",
];

export class TechCrunchRSSAdapter implements SourceAdapter {
  readonly name = "techcrunch-rss";
  readonly displayName = "TechCrunch RSS";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];
    const seenGuids = new Set<string>();

    for (const feedUrl of FEED_URLS) {
      try {
        console.log(`  [${this.name}] Fetching ${feedUrl}`);
        const res = await fetchWithRetry(feedUrl, { rateLimitMs: 3000 });

        if (!res.ok) {
          console.warn(`  [${this.name}] HTTP ${res.status} from ${feedUrl}`);
          continue;
        }

        const xml = await res.text();
        const feed = parseRSS(xml);
        console.log(`  [${this.name}] Parsed ${feed.items.length} items from feed`);

        for (const item of feed.items) {
          // Skip duplicates across feeds
          if (seenGuids.has(item.guid || item.link)) continue;
          seenGuids.add(item.guid || item.link);

          const parsed = parseFundingTitle(item.title);
          if (!parsed) continue;

          // Try to extract missing info from description
          const descText = stripHtml(item.description || item.contentEncoded || "");

          let roundType = parsed.roundType;
          if (!roundType) {
            roundType = extractRoundFromText(descText);
          }
          if (!roundType) continue; // Can't determine round type

          let amount = parsed.amount;
          if (!amount) {
            amount = extractAmountFromText(descText);
          }

          // Extract additional investors from categories
          const investors = [...parsed.investors];

          // Build the scraped result
          const result: ScrapedFundingRound = {
            company: {
              name: parsed.companyName,
              description: descText.slice(0, 500) || null,
              sectors: this.extractSectors(item.categories),
            },
            roundType,
            amountRaw: amount,
            announcedDate: item.pubDate || new Date().toISOString(),
            investors,
            leadInvestors: parsed.investors, // From "led by" patterns
            sourceUrl: item.link,
          };

          results.push(result);
        }
      } catch (err) {
        console.error(`  [${this.name}] Error fetching ${feedUrl}:`, err);
      }
    }

    return results;
  }

  private extractSectors(categories: string[]): string[] {
    // TechCrunch categories often include sector tags
    const sectorKeywords = [
      "artificial intelligence", "ai", "machine learning", "saas",
      "fintech", "healthtech", "edtech", "biotech", "cybersecurity",
      "enterprise", "developer tools", "cloud", "infrastructure",
      "robotics", "autonomous", "climate tech", "clean tech",
      "e-commerce", "marketplace", "social", "crypto", "blockchain",
      "hardware", "iot", "space", "defense", "gaming",
    ];

    return categories.filter((cat) => {
      const lower = cat.toLowerCase();
      return sectorKeywords.some((kw) => lower.includes(kw));
    });
  }
}
