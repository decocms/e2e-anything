import type { SourceAdapter, ScrapedFundingRound } from "./types";
import Exa from "exa-js";
import { parseFundingTitle, extractRoundFromText, extractAmountFromText } from "../lib/title-parser";

/**
 * Exa.ai Search Adapter
 *
 * Uses Exa's semantic search API to find AI startup funding articles
 * across the entire web. Much more comprehensive than RSS feeds.
 *
 * Free tier: 1000 requests/month
 * Strategy: ~25 targeted queries × 100 results each = 2500 articles scanned
 *           Uses only ~25 API calls, well within free tier.
 */

const EXA_API_KEY = process.env.EXA_API_KEY || "";

// Semantic search queries — Exa understands meaning, not just keywords
const SEARCH_QUERIES = [
  // Core funding queries
  "AI startup raises Series A funding round 2026",
  "AI startup raises Series B funding round 2026",
  "AI startup raises Series C funding round 2026",
  "AI startup raises Series D funding round",
  "AI startup raises Series E funding round",
  "artificial intelligence company secures Series A million",
  "artificial intelligence company closes Series B million",
  "generative AI startup raises funding round",
  "machine learning startup raises Series funding",
  "LLM startup funding round Series",
  "AI agent startup raises million",
  "AI infrastructure startup funding Series",

  // Sector-specific
  "AI healthcare startup raises Series funding",
  "AI cybersecurity startup raises Series funding",
  "AI fintech startup raises funding round",
  "robotics startup raises Series A B C",
  "autonomous vehicle AI startup raises Series",
  "computer vision startup raises funding",
  "AI drug discovery startup raises Series",
  "AI defense startup raises funding",

  // Regional
  "AI startup raises Series funding Europe 2026",
  "AI startup raises funding Israel 2026",
  "AI startup raises Series India 2026",
  "AI startup raises funding round UK 2026",
  "AI startup raises Series Asia 2026",
];

export class ExaSearchAdapter implements SourceAdapter {
  readonly name = "exa-search";
  readonly displayName = "Exa.ai Search";

  private exa: Exa | null = null;

  private getClient(): Exa | null {
    if (!EXA_API_KEY) {
      console.warn(`  [${this.name}] No EXA_API_KEY set — skipping Exa search`);
      return null;
    }
    if (!this.exa) {
      this.exa = new Exa(EXA_API_KEY);
    }
    return this.exa;
  }

  async scrape(): Promise<ScrapedFundingRound[]> {
    const exa = this.getClient();
    if (!exa) return [];

    const results: ScrapedFundingRound[] = [];
    const seenTitles = new Set<string>();

    // Date range: last 90 days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const startPublishedDate = startDate.toISOString().split("T")[0] + "T00:00:00.000Z";

    let totalArticles = 0;
    let totalDeals = 0;

    for (const query of SEARCH_QUERIES) {
      try {
        const response = await exa.searchAndContents(query, {
          type: "auto",
          numResults: 100,
          category: "news",
          startPublishedDate,
          text: { maxCharacters: 3000 },
          highlights: {
            numSentences: 3,
            query: "raises Series funding million billion investors"
          },
        });

        totalArticles += response.results.length;

        for (const result of response.results) {
          // Dedup
          const titleKey = (result.title || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
          if (seenTitles.has(titleKey)) continue;
          seenTitles.add(titleKey);

          const deals = this.extractDeals(result);
          totalDeals += deals.length;
          results.push(...deals);
        }

        // Small delay between queries to be nice
        await Bun.sleep(200);
      } catch (err) {
        console.warn(`  [${this.name}] Query failed: "${query.slice(0, 50)}...":`, (err as Error).message);
      }
    }

    console.log(`  [${this.name}] Scanned ${totalArticles} articles, extracted ${totalDeals} deals`);

    return results;
  }

  private extractDeals(result: any): ScrapedFundingRound[] {
    const deals: ScrapedFundingRound[] = [];
    const title = result.title || "";
    const text = result.text || "";
    const highlights = (result.highlights || []).join(" ");
    const url = result.url || "";
    const pubDate = result.publishedDate || new Date().toISOString();

    // Strategy 1: Parse the title
    const titleParsed = parseFundingTitle(title);
    if (titleParsed && titleParsed.companyName) {
      let roundType = titleParsed.roundType;
      if (!roundType) roundType = extractRoundFromText(text.slice(0, 500));
      if (!roundType) roundType = extractRoundFromText(highlights);

      let amount = titleParsed.amount;
      if (!amount) amount = extractAmountFromText(text.slice(0, 500));
      if (!amount) amount = extractAmountFromText(highlights);

      if (roundType) {
        deals.push({
          company: {
            name: titleParsed.companyName,
            description: (highlights || text.slice(0, 500)).replace(/\s+/g, " ").trim() || null,
            website: this.extractCompanyUrl(text, titleParsed.companyName),
            sectors: this.extractSectors(text),
          },
          roundType,
          amountRaw: amount,
          announcedDate: pubDate,
          investors: titleParsed.investors,
          leadInvestors: titleParsed.investors,
          sourceUrl: url,
        });
        return deals; // Title already captured the deal
      }
    }

    // Strategy 2: Look for funding patterns in the text body
    // This catches articles where the title doesn't follow standard patterns
    const sentences = text.split(/[.!?]\s+/);
    for (const sentence of sentences) {
      if (sentence.length < 20 || sentence.length > 500) continue;

      const lower = sentence.toLowerCase();
      if (
        !lower.includes("raise") && !lower.includes("series") &&
        !lower.includes("funding") && !lower.includes("secure") &&
        !lower.includes("close") && !lower.includes("round")
      ) continue;

      const parsed = parseFundingTitle(sentence);
      if (parsed && parsed.companyName && parsed.roundType) {
        // Don't duplicate
        if (deals.some(d => d.company.name.toLowerCase() === parsed.companyName.toLowerCase())) continue;

        deals.push({
          company: {
            name: parsed.companyName,
            description: sentence.trim(),
            sectors: this.extractSectors(text),
          },
          roundType: parsed.roundType,
          amountRaw: parsed.amount || extractAmountFromText(sentence),
          announcedDate: pubDate,
          investors: parsed.investors,
          leadInvestors: parsed.investors,
          sourceUrl: url,
        });
      }
    }

    return deals;
  }

  private extractCompanyUrl(text: string, companyName: string): string | null {
    // Try to find the company's website in the article
    const urlPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-z]{2,})/gi;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      const domain = match[1].toLowerCase();
      // Skip news/social domains
      if (
        domain.includes("techcrunch") || domain.includes("crunchbase") ||
        domain.includes("google") || domain.includes("twitter") ||
        domain.includes("linkedin") || domain.includes("facebook") ||
        domain.includes("venturebeat") || domain.includes("reuters") ||
        domain.includes("bloomberg")
      ) continue;

      // Heuristic: if the domain contains part of the company name, it's likely the company site
      const nameLower = companyName.toLowerCase().replace(/\s+/g, "");
      if (domain.includes(nameLower.slice(0, 5))) {
        return `https://${domain}`;
      }
    }
    return null;
  }

  private extractSectors(text: string): string[] {
    const lower = text.toLowerCase();
    const sectors: string[] = [];

    const sectorMap: Record<string, string> = {
      "artificial intelligence": "Artificial Intelligence",
      "machine learning": "Machine Learning",
      "generative ai": "Generative AI",
      "large language model": "LLM",
      "cybersecurity": "Cybersecurity",
      "fintech": "Fintech",
      "healthcare": "Healthcare",
      "healthtech": "Healthtech",
      "biotech": "Biotech",
      "edtech": "Edtech",
      "climate tech": "Climate Tech",
      "saas": "SaaS",
      "enterprise": "Enterprise",
      "robotics": "Robotics",
      "autonomous": "Autonomous Systems",
      "developer tools": "Developer Tools",
      "infrastructure": "Infrastructure",
      "cloud": "Cloud",
      "defense": "Defense",
      "drug discovery": "Drug Discovery",
      "computer vision": "Computer Vision",
      "natural language": "NLP",
      "ai agent": "AI Agents",
    };

    for (const [keyword, sector] of Object.entries(sectorMap)) {
      if (lower.includes(keyword)) sectors.push(sector);
    }

    return [...new Set(sectors)];
  }
}
