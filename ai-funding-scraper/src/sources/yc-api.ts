import type { SourceAdapter, ScrapedFundingRound, ScrapedCompany } from "./types";
import { fetchWithRetry } from "../lib/fetch-helpers";

/**
 * Y Combinator Open Source API adapter.
 * Source: https://github.com/yc-oss/api
 *
 * YC's API provides company profiles with industry tags.
 * We use the AI-tagged companies and cross-reference with
 * other data to find recent funding rounds.
 *
 * The YC API also has a /companies/all.json endpoint with
 * top_company, stage, and other fields.
 */

const YC_BASE = "https://yc-oss.github.io/api";

interface YCCompany {
  id: number;
  name: string;
  slug: string;
  former_names?: string[];
  small_logo_thumb_url?: string;
  website?: string;
  all_locations?: string;
  long_description?: string;
  one_liner?: string;
  team_size?: number;
  industry?: string;
  subindustry?: string;
  launched_at?: number;
  tags?: string[];
  top_company?: boolean;
  isHiring?: boolean;
  nonprofit?: boolean;
  batch?: string;
  status?: string;
  industries?: string[];
  regions?: string[];
  stage?: string;
  app_video_public?: boolean;
  demo_day_video_public?: boolean;
  app_answers?: Record<string, string>;
  question_answers?: boolean;
  url?: string;
}

export class YCApiAdapter implements SourceAdapter {
  readonly name = "yc-api";
  readonly displayName = "Y Combinator API";

  async scrape(): Promise<ScrapedFundingRound[]> {
    const results: ScrapedFundingRound[] = [];

    try {
      // Fetch all YC companies
      console.log(`  [${this.name}] Fetching all YC companies...`);
      const res = await fetchWithRetry(`${YC_BASE}/companies/all.json`, { rateLimitMs: 1000 });

      if (!res.ok) {
        console.warn(`  [${this.name}] HTTP ${res.status}`);
        return results;
      }

      const companies: YCCompany[] = await res.json();
      console.log(`  [${this.name}] Loaded ${companies.length} total YC companies`);

      // Filter for AI-related companies
      const aiCompanies = companies.filter((c) => this.isAICompany(c));
      console.log(`  [${this.name}] Found ${aiCompanies.length} AI-related companies`);

      // Filter for companies that appear to have raised (stage field)
      // YC tracks stages: "Early", "Growth", "Public", etc.
      const fundedAI = aiCompanies.filter(
        (c) =>
          c.stage === "Growth" ||
          c.stage === "Series A" ||
          c.stage === "Series B" ||
          c.stage === "Series C" ||
          c.top_company === true ||
          (c.team_size && c.team_size > 20) // Heuristic: larger teams likely raised
      );

      console.log(`  [${this.name}] ${fundedAI.length} AI companies with growth indicators`);

      for (const company of fundedAI) {
        const scrapedCompany: ScrapedCompany = {
          name: company.name,
          description: company.long_description || company.one_liner || null,
          website: company.website || (company.url ? `https://www.ycombinator.com/companies/${company.slug}` : null),
          hqLocation: company.all_locations || null,
          sectors: [
            ...(company.industries || []),
            ...(company.tags || []),
            company.industry || "",
            company.subindustry || "",
          ].filter(Boolean),
          logoUrl: company.small_logo_thumb_url || null,
          employeeCount: company.team_size ? String(company.team_size) : null,
          ycBatch: company.batch || null,
        };

        // If YC provides stage info, use it as the round type
        const roundType = company.stage || "Growth";

        // We create a "synthetic" funding round — the exact date/amount
        // may be enriched by other sources via dedup matching
        results.push({
          company: scrapedCompany,
          roundType,
          amountRaw: null, // YC API doesn't provide amount
          announcedDate: company.launched_at
            ? new Date(company.launched_at * 1000).toISOString()
            : new Date().toISOString(),
          investors: ["Y Combinator"],
          sourceUrl: `https://www.ycombinator.com/companies/${company.slug}`,
        });
      }
    } catch (err) {
      console.error(`  [${this.name}] Error:`, err);
    }

    return results;
  }

  private isAICompany(company: YCCompany): boolean {
    const aiKeywords = [
      "artificial intelligence", "machine learning", "ai", "ml",
      "deep learning", "nlp", "natural language", "computer vision",
      "generative", "llm", "foundation model", "neural",
      "robotics", "autonomous", "ai-powered",
    ];

    // Check industries
    const industries = (company.industries || []).map((i) => i.toLowerCase());
    if (industries.some((i) => aiKeywords.some((kw) => i.includes(kw)))) return true;

    // Check tags
    const tags = (company.tags || []).map((t) => t.toLowerCase());
    if (tags.some((t) => aiKeywords.some((kw) => t.includes(kw)))) return true;

    // Check industry/subindustry
    const industry = (company.industry || "").toLowerCase();
    const sub = (company.subindustry || "").toLowerCase();
    if (aiKeywords.some((kw) => industry.includes(kw) || sub.includes(kw))) return true;

    // Check description
    const desc = (company.long_description || company.one_liner || "").toLowerCase();
    let hits = 0;
    for (const kw of aiKeywords) {
      if (desc.includes(kw)) {
        hits++;
        if (hits >= 2) return true;
      }
    }

    return false;
  }
}
