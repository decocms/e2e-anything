import type { SourceAdapter, ScrapedFundingRound } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parseRSS, stripHtml } from "../lib/xml-parser";
import { parseFundingTitle, extractRoundFromText, extractAmountFromText } from "../lib/title-parser";
import { parse as parseHTML } from "node-html-parser";

const FEED_URL = "https://news.crunchbase.com/feed/";

// Crunchbase News archive pages for broader coverage
const ARCHIVE_PAGES = [
  "https://news.crunchbase.com/venture/",
  "https://news.crunchbase.com/venture/page/2/",
  "https://news.crunchbase.com/venture/page/3/",
  "https://news.crunchbase.com/venture/page/4/",
  "https://news.crunchbase.com/venture/page/5/",
  "https://news.crunchbase.com/venture/page/6/",
  "https://news.crunchbase.com/venture/page/7/",
  "https://news.crunchbase.com/venture/page/8/",
  "https://news.crunchbase.com/ai/",
  "https://news.crunchbase.com/ai/page/2/",
  "https://news.crunchbase.com/ai/page/3/",
  "https://news.crunchbase.com/ai/page/4/",
];

export class CrunchbaseRSSAdapter implements SourceAdapter {
  readonly name = "crunchbase-rss";
  readonly displayName = "Crunchbase News";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];
    const seenUrls = new Set<string>();

    // 1. RSS feed (latest 10 items)
    try {
      console.log(`  [${this.name}] Fetching RSS feed...`);
      const rssResults = await this.scrapeRSSFeed(seenUrls);
      results.push(...rssResults);
      console.log(`  [${this.name}] RSS: ${rssResults.length} items`);
    } catch (err) {
      console.error(`  [${this.name}] RSS error:`, err);
    }

    // 2. Scrape archive pages for article links
    const articleUrls: string[] = [];
    for (const pageUrl of ARCHIVE_PAGES) {
      try {
        const urls = await this.getArticleLinksFromPage(pageUrl);
        for (const url of urls) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            articleUrls.push(url);
          }
        }
      } catch (err) {
        console.warn(`  [${this.name}] Page scrape failed: ${pageUrl}`);
      }
    }

    console.log(`  [${this.name}] Found ${articleUrls.length} article links to follow`);

    // 3. Scrape individual articles for deals
    let articleDeals = 0;
    for (const url of articleUrls.slice(0, 50)) {
      try {
        const articleResults = await this.scrapeArticle(url);
        results.push(...articleResults);
        articleDeals += articleResults.length;
      } catch {
        // Skip failures silently
      }
    }

    console.log(`  [${this.name}] Article scraping: ${articleDeals} additional deals`);
    return results;
  }

  private async scrapeRSSFeed(seenUrls: Set<string>): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    const res = await fetchWithRetry(FEED_URL, { rateLimitMs: 2000 });
    if (!res.ok) return results;

    const xml = await res.text();
    const feed = parseRSS(xml);

    for (const item of feed.items) {
      seenUrls.add(item.link);
      const parsed = parseFundingTitle(item.title);

      if (parsed) {
        const descText = stripHtml(item.description || item.contentEncoded || "");
        let roundType = parsed.roundType;
        if (!roundType) roundType = extractRoundFromText(descText);
        if (!roundType) continue;

        results.push({
          company: {
            name: parsed.companyName,
            description: descText.slice(0, 500) || null,
            sectors: item.categories,
          },
          roundType,
          amountRaw: parsed.amount || extractAmountFromText(descText),
          announcedDate: item.pubDate || new Date().toISOString(),
          investors: parsed.investors,
          leadInvestors: parsed.investors,
          sourceUrl: item.link,
        });
        continue;
      }

      // Multi-deal articles
      const bodyHtml = item.contentEncoded || item.description || "";
      if (bodyHtml.length > 200) {
        const multiDeals = this.parseMultiDealContent(bodyHtml, item.link, item.pubDate);
        results.push(...multiDeals);
      }
    }

    return results;
  }

  private async getArticleLinksFromPage(pageUrl: string): Promise<string[]> {
    const res = await fetchWithRetry(pageUrl, { rateLimitMs: 2000 });
    if (!res.ok) return [];

    const html = await res.text();
    const root = parseHTML(html);
    const urls: string[] = [];

    const links = root.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (
        href.startsWith("https://news.crunchbase.com/") &&
        !href.includes("/page/") && !href.includes("/author/") &&
        !href.includes("/category/") && !href.includes("/tag/") &&
        (href.includes("/venture/") || href.includes("/ai/")) &&
        href.length > 50
      ) {
        if (!urls.includes(href)) urls.push(href);
      }
    }

    return urls;
  }

  private async scrapeArticle(url: string): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    const res = await fetchWithRetry(url, { rateLimitMs: 1500 });
    if (!res.ok) return results;

    const html = await res.text();
    const root = parseHTML(html);

    const article = root.querySelector(".entry-content, .post-content, article, main");
    if (!article) return results;

    // Get article date
    const dateEl = root.querySelector("time[datetime], meta[property='article:published_time']");
    const articleDate = dateEl?.getAttribute("datetime") ||
      dateEl?.getAttribute("content") ||
      new Date().toISOString();

    // Parse headings, paragraphs, list items for deals
    const elements = article.querySelectorAll("h2, h3, h4, strong, b, li, p");
    const seenNames = new Set<string>();

    for (const el of elements) {
      const text = el.text.trim();
      if (text.length < 10 || text.length > 500) continue;

      const parsed = parseFundingTitle(text);
      if (parsed && parsed.companyName) {
        let roundType = parsed.roundType;
        if (!roundType) roundType = extractRoundFromText(text);
        if (!roundType) continue;

        const nameLower = parsed.companyName.toLowerCase();
        if (seenNames.has(nameLower)) continue;
        seenNames.add(nameLower);

        results.push({
          company: {
            name: parsed.companyName,
            description: text.slice(0, 500),
            sectors: [],
          },
          roundType,
          amountRaw: parsed.amount || extractAmountFromText(text),
          announcedDate: articleDate,
          investors: parsed.investors,
          leadInvestors: parsed.investors,
          sourceUrl: url,
        });
      }
    }

    return results;
  }

  private parseMultiDealContent(html: string, sourceUrl: string, pubDate: string): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];
    try {
      const root = parseHTML(html);
      const elements = root.querySelectorAll("h2, h3, h4, strong, b, li, p");
      const seenNames = new Set<string>();

      for (const el of elements) {
        const text = el.text.trim();
        const parsed = parseFundingTitle(text);
        if (parsed && parsed.roundType) {
          const nameLower = parsed.companyName.toLowerCase();
          if (seenNames.has(nameLower)) continue;
          seenNames.add(nameLower);

          results.push({
            company: { name: parsed.companyName, description: null },
            roundType: parsed.roundType,
            amountRaw: parsed.amount,
            announcedDate: pubDate || new Date().toISOString(),
            investors: parsed.investors,
            sourceUrl,
          });
        }
      }
    } catch { /* skip */ }
    return results;
  }
}
