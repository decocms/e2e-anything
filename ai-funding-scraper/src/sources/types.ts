/**
 * Shared types for all source adapters
 */

export interface ScrapedCompany {
  name: string;
  description?: string | null;
  website?: string | null;
  foundedYear?: number | null;
  hqLocation?: string | null;
  hqCountry?: string | null;
  sectors?: string[];
  logoUrl?: string | null;
  employeeCount?: string | null;
  ycBatch?: string | null;
}

export interface ScrapedFundingRound {
  company: ScrapedCompany;
  roundType: string;
  amountRaw?: string | null;
  announcedDate: string;
  investors?: string[];
  leadInvestors?: string[];
  sourceUrl: string;
}

export interface SourceAdapter {
  /** Unique identifier for this source, e.g. "techcrunch-rss" */
  readonly name: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Scrape and return funding round data */
  scrape(): Promise<ScrapedFundingRound[]>;
}
