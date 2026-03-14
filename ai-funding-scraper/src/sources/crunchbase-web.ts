import type { SourceAdapter, ScrapedFundingRound, ScrapedCompany } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parse as parseHTML } from "node-html-parser";

/**
 * Crunchbase Database Adapter
 *
 * Scrapes Crunchbase's publicly accessible funding data via multiple approaches:
 * 1. Crunchbase recent funding activity pages
 * 2. Crunchbase search for AI companies with recent funding
 * 3. Crunchbase company profile pages for enrichment
 *
 * NOTE: This adapter respects rate limits and only accesses publicly visible data.
 * If Crunchbase blocks requests, it degrades gracefully.
 */

const BASE_URL = "https://www.crunchbase.com";

// Crunchbase uses these public API-like endpoints that power their frontend
const SEARCH_URL = "https://www.crunchbase.com/v4/data/searches/funding_rounds";
const DISCOVER_URL = "https://www.crunchbase.com/discover/funding_rounds";

// Public organization/funding pages
const LISTS_URL = "https://www.crunchbase.com/lists/ai-companies-raising-series-a-and-beyond";

// Crunchbase renders funding data in structured formats on these public pages
const RECENT_ACTIVITY_URLS = [
  "https://www.crunchbase.com/discover/funding_rounds/field/funding_round/announced_on",
  "https://www.crunchbase.com/hub/artificial-intelligence-funding-rounds",
  "https://www.crunchbase.com/hub/series-a-funding-rounds",
  "https://www.crunchbase.com/hub/series-b-funding-rounds",
  "https://www.crunchbase.com/hub/series-c-funding-rounds",
];

export class CrunchbaseWebAdapter implements SourceAdapter {
  readonly name = "crunchbase-web";
  readonly displayName = "Crunchbase Database";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    // Strategy 1: Try to scrape funding hub pages
    for (const url of RECENT_ACTIVITY_URLS) {
      try {
        const pageResults = await this.scrapeFundingPage(url);
        results.push(...pageResults);
        console.log(`  [${this.name}] Found ${pageResults.length} rounds from ${url}`);
      } catch (err) {
        console.warn(`  [${this.name}] Failed to scrape ${url}: ${(err as Error).message}`);
      }
    }

    // Strategy 2: Try the Crunchbase Discover API (public search)
    try {
      const discoverResults = await this.scrapeDiscover();
      results.push(...discoverResults);
      console.log(`  [${this.name}] Found ${discoverResults.length} rounds from Discover`);
    } catch (err) {
      console.warn(`  [${this.name}] Discover API failed: ${(err as Error).message}`);
    }

    // Strategy 3: Try scraping the Crunchbase daily funding brief
    try {
      const briefResults = await this.scrapeDailyBrief();
      results.push(...briefResults);
    } catch (err) {
      console.warn(`  [${this.name}] Daily brief failed: ${(err as Error).message}`);
    }

    return results;
  }

  /**
   * Scrape a Crunchbase hub/discover page for funding round data.
   * These pages contain structured tables with company names, amounts, rounds, dates.
   */
  private async scrapeFundingPage(url: string): Promise<ScrapedFundingRound[]> {
    const res = await fetchWithRetry(url, {
      rateLimitMs: 5000,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      if (res.status === 403) {
        console.warn(`  [${this.name}] Access blocked (403) for ${url}`);
        return [];
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    return this.parseFundingHtml(html, url);
  }

  /**
   * Parse HTML from Crunchbase pages that contain funding round data.
   * Crunchbase renders data in structured HTML with identifiable patterns.
   */
  private parseFundingHtml(html: string, sourceUrl: string): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];
    const root = parseHTML(html);

    // Approach 1: Look for structured data / JSON-LD
    const jsonLdScripts = root.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.text);
        if (data["@type"] === "Dataset" || Array.isArray(data)) {
          // Process structured data
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const round = this.extractFromJsonLd(item, sourceUrl);
            if (round) results.push(round);
          }
        }
      } catch { /* not valid JSON-LD */ }
    }

    // Approach 2: Parse table rows
    const tables = root.querySelectorAll("table");
    for (const table of tables) {
      const rows = table.querySelectorAll("tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          const round = this.parseTableRow(cells.map(c => c.text.trim()), sourceUrl);
          if (round) results.push(round);
        }
      }
    }

    // Approach 3: Parse grid/card layouts (Crunchbase uses these)
    const cards = root.querySelectorAll('[class*="card"], [class*="grid-row"], [class*="funding"]');
    for (const card of cards) {
      const round = this.parseCardElement(card, sourceUrl);
      if (round) results.push(round);
    }

    // Approach 4: Look for embedded data in script tags (React hydration data)
    const scripts = root.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.text;
      if (text.includes("funding_round") || text.includes("fundingRound")) {
        try {
          // Try to find JSON data embedded in the script
          const jsonMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            const embedded = this.extractFromHydrationData(data, sourceUrl);
            results.push(...embedded);
          }
        } catch { /* not parseable */ }
      }
    }

    return results;
  }

  private extractFromJsonLd(item: any, sourceUrl: string): ScrapedFundingRound | null {
    try {
      if (item.name && item.description) {
        // Try to extract funding info from JSON-LD
        return null; // Usually not in JSON-LD format
      }
    } catch { /* skip */ }
    return null;
  }

  /**
   * Parse a table row that might contain [Company, Amount, Round, Date, Investors]
   */
  private parseTableRow(cells: string[], sourceUrl: string): ScrapedFundingRound | null {
    if (cells.length < 3) return null;

    // Try to identify columns by content patterns
    let companyName: string | null = null;
    let amount: string | null = null;
    let roundType: string | null = null;
    let date: string | null = null;
    let investors: string[] = [];

    for (const cell of cells) {
      // Amount pattern
      if (/^\$[\d,.]+[BMK]?$/.test(cell.replace(/\s/g, ""))) {
        amount = cell;
        continue;
      }

      // Round type pattern
      if (/^Series\s+[A-H]|^Growth|^Late\s+Stage/i.test(cell)) {
        roundType = cell;
        continue;
      }

      // Date pattern
      if (/^\w+\s+\d{1,2},?\s+\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(cell)) {
        date = cell;
        continue;
      }

      // Investor list (contains commas, common VC names)
      if (cell.includes(",") && (
        cell.includes("Capital") || cell.includes("Ventures") ||
        cell.includes("Partners") || cell.includes("Fund")
      )) {
        investors = cell.split(",").map(s => s.trim()).filter(Boolean);
        continue;
      }

      // Company name (first unclassified cell)
      if (!companyName && cell.length > 1 && cell.length < 100) {
        companyName = cell;
      }
    }

    if (companyName && roundType) {
      return {
        company: { name: companyName },
        roundType,
        amountRaw: amount,
        announcedDate: date || new Date().toISOString(),
        investors,
        sourceUrl,
      };
    }

    return null;
  }

  /**
   * Parse a card/grid element that might contain funding round info
   */
  private parseCardElement(card: any, sourceUrl: string): ScrapedFundingRound | null {
    const text = card.text?.trim() || "";
    if (text.length < 10 || text.length > 2000) return null;

    // Look for patterns within the card text
    const companyMatch = text.match(/^([A-Z][^\n]+)/);
    const amountMatch = text.match(/\$([\d,.]+)\s*(?:billion|B|million|M|K)/i);
    const roundMatch = text.match(/Series\s+[A-H]|Growth|Late\s+Stage/i);
    const dateMatch = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}/i);

    if (companyMatch && roundMatch) {
      return {
        company: { name: companyMatch[1].trim().slice(0, 100) },
        roundType: roundMatch[0],
        amountRaw: amountMatch ? amountMatch[0] : null,
        announcedDate: dateMatch ? dateMatch[0] : new Date().toISOString(),
        investors: [],
        sourceUrl,
      };
    }

    return null;
  }

  /**
   * Extract funding data from React/Next.js hydration data
   */
  private extractFromHydrationData(data: any, sourceUrl: string): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];

    // Recursively search for funding round objects
    const search = (obj: any, depth = 0) => {
      if (depth > 10 || !obj) return;
      if (typeof obj !== "object") return;

      // Check if this looks like a funding round
      if (obj.money_raised || obj.moneyRaised || obj.funding_type || obj.fundingType) {
        const name = obj.org_name || obj.orgName || obj.organization?.name || obj.company_name;
        const round = obj.funding_type || obj.fundingType || obj.series || obj.round_type;
        const amount = obj.money_raised?.value_usd || obj.moneyRaised || obj.amount;
        const date = obj.announced_on || obj.announcedOn || obj.date;

        if (name && round) {
          const investors: string[] = [];
          if (obj.investors) {
            for (const inv of Array.isArray(obj.investors) ? obj.investors : []) {
              investors.push(inv.name || inv.investor_name || String(inv));
            }
          }

          results.push({
            company: {
              name,
              description: obj.org_description || obj.description || null,
              website: obj.homepage_url || obj.website || null,
            },
            roundType: round,
            amountRaw: amount ? `$${amount}` : null,
            announcedDate: date || new Date().toISOString(),
            investors,
            sourceUrl,
          });
        }
      }

      // Recurse into arrays and objects
      if (Array.isArray(obj)) {
        for (const item of obj) search(item, depth + 1);
      } else {
        for (const value of Object.values(obj)) {
          if (typeof value === "object" && value !== null) {
            search(value, depth + 1);
          }
        }
      }
    };

    search(data);
    return results;
  }

  /**
   * Try to use Crunchbase's Discover API
   * This is the search endpoint that powers crunchbase.com/discover/funding_rounds
   */
  private async scrapeDiscover(): Promise<ScrapedFundingRound[]> {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Crunchbase's internal search API
    const res = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      rateLimitMs: 5000,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        field_ids: [
          "identifier", "funded_organization_identifier",
          "money_raised", "announced_on", "funding_type",
          "investor_identifiers", "funded_organization_description",
          "funded_organization_categories",
        ],
        query: [
          {
            type: "predicate",
            field_id: "announced_on",
            operator_id: "gte",
            values: [threeMonthsAgo.toISOString().split("T")[0]],
          },
          {
            type: "predicate",
            field_id: "funding_type",
            operator_id: "includes",
            values: [
              "series_a", "series_b", "series_c", "series_d",
              "series_e", "series_f", "private_equity", "corporate_round",
            ],
          },
        ],
        order: [{ field_id: "announced_on", sort: "desc" }],
        limit: 100,
      }),
    });

    if (!res.ok) {
      throw new Error(`Discover API returned ${res.status}`);
    }

    const data = await res.json();
    return this.parseDiscoverResponse(data);
  }

  private parseDiscoverResponse(data: any): ScrapedFundingRound[] {
    const results: ScrapedFundingRound[] = [];

    try {
      const entities = data?.entities || data?.results || [];
      for (const entity of entities) {
        const props = entity.properties || entity;

        const orgId = props.funded_organization_identifier || {};
        const companyName = orgId.value || orgId.name || props.org_name;
        if (!companyName) continue;

        const fundingType = props.funding_type || props.series || "";
        const moneyRaised = props.money_raised?.value_usd || props.money_raised?.value;
        const announcedOn = props.announced_on || new Date().toISOString().split("T")[0];

        const investors: string[] = [];
        if (props.investor_identifiers) {
          for (const inv of Array.isArray(props.investor_identifiers)
            ? props.investor_identifiers : []) {
            investors.push(inv.value || inv.name || String(inv));
          }
        }

        const categories = props.funded_organization_categories || [];
        const sectors = categories.map((c: any) => c.value || c.name || String(c));

        results.push({
          company: {
            name: companyName,
            description: props.funded_organization_description || null,
            website: orgId.permalink
              ? `https://www.crunchbase.com/organization/${orgId.permalink}`
              : null,
            sectors,
          },
          roundType: this.normalizeCBRoundType(fundingType),
          amountRaw: moneyRaised ? `$${moneyRaised}` : null,
          announcedDate: announcedOn,
          investors,
          sourceUrl: orgId.permalink
            ? `https://www.crunchbase.com/funding_round/${orgId.permalink}`
            : `https://www.crunchbase.com/discover/funding_rounds`,
        });
      }
    } catch (err) {
      console.warn(`  [${this.name}] Failed to parse Discover response:`, err);
    }

    return results;
  }

  /**
   * Scrape Crunchbase's daily funding brief / newsletter page
   */
  private async scrapeDailyBrief(): Promise<ScrapedFundingRound[]> {
    const urls = [
      "https://news.crunchbase.com/venture/",
      "https://news.crunchbase.com/ai/",
    ];

    const results: ScrapedFundingRound[] = [];

    for (const url of urls) {
      try {
        const res = await fetchWithRetry(url, { rateLimitMs: 5000 });
        if (!res.ok) continue;

        const html = await res.text();
        const root = parseHTML(html);

        // Look for article links and titles that mention funding
        const articles = root.querySelectorAll("article, .post-item, .article-card, a[href*='/venture/'], a[href*='/ai/']");

        for (const article of articles) {
          const title = article.querySelector("h2, h3, .title")?.text?.trim() || article.text?.trim();
          if (!title) continue;

          const link = article.getAttribute("href") ||
            article.querySelector("a")?.getAttribute("href") || "";

          // Try to parse funding from the article title
          const { parseFundingTitle } = await import("../lib/title-parser");
          const parsed = parseFundingTitle(title);

          if (parsed && parsed.roundType) {
            results.push({
              company: { name: parsed.companyName },
              roundType: parsed.roundType,
              amountRaw: parsed.amount,
              announcedDate: new Date().toISOString(),
              investors: parsed.investors,
              sourceUrl: link.startsWith("http") ? link : `https://news.crunchbase.com${link}`,
            });
          }
        }
      } catch (err) {
        console.warn(`  [${this.name}] Daily brief error for ${url}:`, err);
      }
    }

    return results;
  }

  private normalizeCBRoundType(type: string): string {
    const map: Record<string, string> = {
      series_a: "Series A",
      series_b: "Series B",
      series_c: "Series C",
      series_d: "Series D",
      series_e: "Series E",
      series_f: "Series F",
      private_equity: "Private Equity",
      corporate_round: "Corporate Round",
      post_ipo_equity: "Post-IPO",
      grant: "Grant",
      debt_financing: "Debt",
    };
    return map[type.toLowerCase()] || type;
  }
}
