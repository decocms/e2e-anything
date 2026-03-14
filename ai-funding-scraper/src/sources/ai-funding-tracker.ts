import type { SourceAdapter, ScrapedFundingRound } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parse as parseHTML } from "node-html-parser";
import { parseFundingTitle, extractRoundFromText, extractAmountFromText } from "../lib/title-parser";

/**
 * AI Funding Tracker adapter.
 * Scrapes aifundingtracker.com for AI-specific funding rounds.
 */

const BASE_URL = "https://aifundingtracker.com";

export class AIFundingTrackerAdapter implements SourceAdapter {
  readonly name = "ai-funding-tracker";
  readonly displayName = "AI Funding Tracker";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    try {
      console.log(`  [${this.name}] Fetching ${BASE_URL}`);
      const res = await fetchWithRetry(BASE_URL, { rateLimitMs: 5000 });

      if (!res.ok) {
        console.warn(`  [${this.name}] HTTP ${res.status}`);
        return results;
      }

      const html = await res.text();
      const root = parseHTML(html);

      // Strategy 1: Look for table data
      const tableResults = this.parseTables(root);
      results.push(...tableResults);

      // Strategy 2: Look for card/list layouts
      const cardResults = this.parseCards(root);
      results.push(...cardResults);

      // Strategy 3: Look for article links to individual funding pages
      const articleLinks = this.extractArticleLinks(root);
      console.log(`  [${this.name}] Found ${articleLinks.length} article links to follow`);

      // Fetch individual articles (limit to 20 to be respectful)
      for (const link of articleLinks.slice(0, 20)) {
        try {
          const articleResults = await this.scrapeArticle(link);
          results.push(...articleResults);
        } catch {
          // Skip individual article failures
        }
      }

      // Strategy 4: Check for RSS feed
      const rssLink = root.querySelector('link[type="application/rss+xml"]');
      if (rssLink) {
        const rssUrl = rssLink.getAttribute("href");
        if (rssUrl) {
          try {
            const rssResults = await this.scrapeRSS(
              rssUrl.startsWith("http") ? rssUrl : `${BASE_URL}${rssUrl}`
            );
            results.push(...rssResults);
          } catch (err) {
            console.warn(`  [${this.name}] RSS scrape failed:`, err);
          }
        }
      }

      console.log(`  [${this.name}] Total: ${results.length} funding rounds`);
    } catch (err) {
      console.error(`  [${this.name}] Error:`, err);
    }

    return results;
  }

  private parseTables(root: any): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];
    const tables = root.querySelectorAll("table");

    for (const table of tables) {
      // Try to identify column headers
      const headers = table.querySelectorAll("th").map((th: any) => th.text.trim().toLowerCase());
      const nameIdx = headers.findIndex((h: string) =>
        h.includes("company") || h.includes("startup") || h.includes("name")
      );
      const amountIdx = headers.findIndex((h: string) =>
        h.includes("amount") || h.includes("raised") || h.includes("funding")
      );
      const roundIdx = headers.findIndex((h: string) =>
        h.includes("round") || h.includes("stage") || h.includes("type") || h.includes("series")
      );
      const dateIdx = headers.findIndex((h: string) =>
        h.includes("date") || h.includes("announced")
      );
      const investorIdx = headers.findIndex((h: string) =>
        h.includes("investor") || h.includes("led by") || h.includes("lead")
      );

      const rows = table.querySelectorAll("tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) continue;

        const cellTexts = cells.map((c: any) => c.text.trim());

        const companyName = nameIdx >= 0 ? cellTexts[nameIdx] : cellTexts[0];
        const amount = amountIdx >= 0 ? cellTexts[amountIdx] : null;
        const roundType = roundIdx >= 0 ? cellTexts[roundIdx] : null;
        const date = dateIdx >= 0 ? cellTexts[dateIdx] : null;
        const investors = investorIdx >= 0
          ? cellTexts[investorIdx]?.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
          : [];

        if (companyName && companyName.length > 1 && (roundType || amount)) {
          results.push({
            company: {
              name: companyName,
              sectors: ["artificial intelligence"],
            },
            roundType: roundType || "Unknown",
            amountRaw: amount?.includes("$") ? amount : amount ? `$${amount}` : null,
            announcedDate: date || new Date().toISOString(),
            investors: investors || [],
            sourceUrl: BASE_URL,
          });
        }
      }
    }

    return results;
  }

  private parseCards(root: any): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];

    // Look for common card patterns
    const selectors = [
      "[class*='funding']",
      "[class*='deal']",
      "[class*='startup']",
      "[class*='company']",
      ".wp-block-table",
      ".elementor-widget-table",
      "article",
    ];

    for (const selector of selectors) {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.text?.trim() || "";
        if (text.length < 10 || text.length > 5000) continue;

        // Try to parse as a funding announcement
        const parsed = parseFundingTitle(text.split("\n")[0] || "");
        if (parsed && parsed.companyName && parsed.roundType) {
          results.push({
            company: {
              name: parsed.companyName,
              sectors: ["artificial intelligence"],
            },
            roundType: parsed.roundType,
            amountRaw: parsed.amount,
            announcedDate: new Date().toISOString(),
            investors: parsed.investors,
            sourceUrl: BASE_URL,
          });
        }
      }
    }

    return results;
  }

  private extractArticleLinks(root: any): string[] {
    const links: string[] = [];
    const anchors = root.querySelectorAll("a");

    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const text = a.text?.toLowerCase() || "";

      // Look for links to funding-related articles
      if (
        (href.includes("funding") || href.includes("raises") ||
         href.includes("series") || href.includes("round") ||
         text.includes("raise") || text.includes("series") ||
         text.includes("funding")) &&
        !href.includes("login") &&
        !href.includes("signup")
      ) {
        const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        if (!links.includes(fullUrl)) links.push(fullUrl);
      }
    }

    return links;
  }

  private async scrapeArticle(url: string): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    const res = await fetchWithRetry(url, { rateLimitMs: 3000 });
    if (!res.ok) return results;

    const html = await res.text();
    const root = parseHTML(html);

    const title = root.querySelector("h1, .entry-title, .post-title")?.text?.trim() || "";
    const body = root.querySelector(".entry-content, .post-content, article, main")?.text || "";

    const parsed = parseFundingTitle(title);
    if (parsed && parsed.companyName) {
      let roundType = parsed.roundType;
      if (!roundType) roundType = extractRoundFromText(body);

      let amount = parsed.amount;
      if (!amount) amount = extractAmountFromText(body);

      if (roundType) {
        results.push({
          company: {
            name: parsed.companyName,
            description: body.slice(0, 500) || null,
            sectors: ["artificial intelligence"],
          },
          roundType,
          amountRaw: amount,
          announcedDate: new Date().toISOString(),
          investors: parsed.investors,
          sourceUrl: url,
        });
      }
    }

    return results;
  }

  private async scrapeRSS(rssUrl: string): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];
    const { parseRSS, stripHtml } = await import("../lib/xml-parser");

    const res = await fetchWithRetry(rssUrl, { rateLimitMs: 3000 });
    if (!res.ok) return results;

    const xml = await res.text();
    const feed = parseRSS(xml);

    for (const item of feed.items) {
      const parsed = parseFundingTitle(item.title);
      if (!parsed) continue;

      const descText = stripHtml(item.description || "");
      let roundType = parsed.roundType || extractRoundFromText(descText);
      if (!roundType) continue;

      results.push({
        company: {
          name: parsed.companyName,
          description: descText.slice(0, 500) || null,
          sectors: ["artificial intelligence"],
        },
        roundType,
        amountRaw: parsed.amount || extractAmountFromText(descText),
        announcedDate: item.pubDate || new Date().toISOString(),
        investors: parsed.investors,
        sourceUrl: item.link || rssUrl,
      });
    }

    return results;
  }
}
