/**
 * AI Funding Scraper — Main Orchestrator
 *
 * Runs all source adapters, normalizes data, deduplicates,
 * classifies AI-native companies, and stores in SQLite.
 */

import { getDb, closeDb } from "./db";
import * as queries from "./db/queries";
import { normalizeRoundType, parseAmount, normalizeDate, normalizeName, extractDomain } from "./lib/normalize";
import { findMatchingCompany, mergeSources, mergeCompanyFields } from "./lib/dedup";
import { isAINative } from "./lib/ai-classifier";
import type { SourceAdapter, ScrapedFundingRound } from "./sources/types";

// Import all adapters
import { TechCrunchRSSAdapter } from "./sources/techcrunch-rss";
import { CrunchbaseRSSAdapter } from "./sources/crunchbase-rss";
import { CrunchbaseWebAdapter } from "./sources/crunchbase-web";
import { YCApiAdapter } from "./sources/yc-api";
import { AIFundingTrackerAdapter } from "./sources/ai-funding-tracker";
import { NewsRSSAdapter } from "./sources/news-rss";
import { ExaSearchAdapter } from "./sources/exa-search";

function getAdapters(): SourceAdapter[] {
  return [
    new ExaSearchAdapter(),          // Exa.ai semantic search (highest volume)
    new TechCrunchRSSAdapter(),
    new CrunchbaseRSSAdapter(),      // Crunchbase News + article scraping
    new CrunchbaseWebAdapter(),      // Crunchbase database scraper
    new NewsRSSAdapter(),            // VentureBeat, Google News, SiliconAngle, etc.
    new YCApiAdapter(),
    new AIFundingTrackerAdapter(),
  ];
}

export async function runScrape(): Promise<{
  totalFound: number;
  totalNew: number;
  totalUpdated: number;
  bySource: Record<string, { found: number; new: number; updated: number }>;
}> {
  const db = getDb();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoffDate = threeMonthsAgo.toISOString().split("T")[0];

  const adapters = getAdapters();
  const summary = {
    totalFound: 0,
    totalNew: 0,
    totalUpdated: 0,
    bySource: {} as Record<string, { found: number; new: number; updated: number }>,
  };

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AI Funding Scraper — Starting scrape run");
  console.log(`  Date cutoff: ${cutoffDate} (last 3 months)`);
  console.log(`  Sources: ${adapters.map((a) => a.displayName).join(", ")}`);
  console.log("═══════════════════════════════════════════════════════\n");

  for (const adapter of adapters) {
    const runId = queries.startScrapeRun(db, adapter.name);
    let found = 0;
    let newCount = 0;
    let updatedCount = 0;

    try {
      console.log(`\n▶ [${adapter.displayName}] Starting scrape...`);
      const results = await adapter.scrape();
      found = results.length;
      console.log(`  [${adapter.displayName}] Raw results: ${found}`);

      for (const result of results) {
        try {
          const processed = processResult(db, result, adapter.name, cutoffDate);
          if (processed === "new") newCount++;
          else if (processed === "updated") updatedCount++;
        } catch (err) {
          console.warn(`  [${adapter.displayName}] Error processing result:`, err);
        }
      }

      queries.completeScrapeRun(db, runId, found, newCount, updatedCount);
      console.log(`  ✓ [${adapter.displayName}] Done: ${found} found, ${newCount} new, ${updatedCount} updated`);
    } catch (err) {
      queries.failScrapeRun(db, runId, String(err));
      console.error(`  ✗ [${adapter.displayName}] Failed:`, err);
    }

    summary.totalFound += found;
    summary.totalNew += newCount;
    summary.totalUpdated += updatedCount;
    summary.bySource[adapter.name] = { found, new: newCount, updated: updatedCount };
  }

  // Print summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Scrape Complete!");
  console.log(`  Total found: ${summary.totalFound}`);
  console.log(`  New records: ${summary.totalNew}`);
  console.log(`  Updated records: ${summary.totalUpdated}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // Print DB stats
  const stats = queries.getStats(db);
  console.log("  Database stats:");
  console.log(`    Companies: ${stats.total_companies} (${stats.ai_companies} AI-native)`);
  console.log(`    Funding rounds: ${stats.total_rounds} (${stats.rounds_last_90_days} in last 90 days)`);
  console.log(`    Total funding tracked: $${(stats.total_amount_usd / 1e9).toFixed(2)}B`);
  console.log("");

  return summary;
}

function processResult(
  db: ReturnType<typeof getDb>,
  result: ScrapedFundingRound,
  sourceName: string,
  cutoffDate: string
): "new" | "updated" | "skipped" {
  // 1. Normalize round type — skip if not Series A+
  const roundTypeNorm = normalizeRoundType(result.roundType);
  if (!roundTypeNorm) return "skipped";

  // 2. Normalize date — skip if older than cutoff
  const dateNorm = normalizeDate(result.announcedDate);
  if (dateNorm < cutoffDate) return "skipped";

  // 3. Normalize company data
  const normalizedName = normalizeName(result.company.name);
  if (!normalizedName || normalizedName.length < 2) return "skipped";

  const domain = result.company.website ? extractDomain(result.company.website) : null;

  // 4. Classify as AI-native
  const aiNative = isAINative(
    result.company.name,
    result.company.description,
    result.company.sectors,
    result.sourceUrl
  );

  // 5. Dedup: find or create company
  const match = findMatchingCompany(db, result.company.name, result.company.website);

  let companyId: number;
  let isNewCompany = false;

  if (match) {
    companyId = match.id;

    // Merge source list
    const newSources = mergeSources(match.company.sources, sourceName);
    queries.updateCompanySources(db, companyId, JSON.parse(newSources));

    // Merge any new fields
    const fieldUpdates = mergeCompanyFields(match.company, {
      description: result.company.description,
      website: result.company.website,
      domain,
      founded_year: result.company.foundedYear,
      hq_location: result.company.hqLocation,
      hq_country: result.company.hqCountry,
      sectors: result.company.sectors ? JSON.stringify(result.company.sectors) : undefined,
      logo_url: result.company.logoUrl,
      employee_count: result.company.employeeCount,
      yc_batch: result.company.ycBatch,
      is_ai_native: aiNative ? 1 : 0,
    });

    if (Object.keys(fieldUpdates).length > 0) {
      // Manual update with raw SQL for dynamic fields
      const sets = Object.entries(fieldUpdates)
        .map(([k]) => `${k} = $${k}`)
        .join(", ");
      const params: Record<string, unknown> = { $id: companyId };
      for (const [k, v] of Object.entries(fieldUpdates)) {
        params[`$${k}`] = v;
      }
      db.prepare(`UPDATE companies SET ${sets}, updated_at = datetime('now') WHERE id = $id`).run(params);
    }
  } else {
    // Insert new company
    companyId = queries.insertCompany(db, {
      name: result.company.name,
      normalized_name: normalizedName,
      description: result.company.description,
      website: result.company.website,
      domain,
      founded_year: result.company.foundedYear,
      hq_location: result.company.hqLocation,
      hq_country: result.company.hqCountry,
      sectors: result.company.sectors ? JSON.stringify(result.company.sectors) : "[]",
      sources: JSON.stringify([sourceName]),
      is_ai_native: aiNative ? 1 : 0,
      logo_url: result.company.logoUrl,
      employee_count: result.company.employeeCount,
      yc_batch: result.company.ycBatch,
    });
    isNewCompany = true;
  }

  // 6. Insert funding round (dedup via UNIQUE constraint)
  const existingRound = queries.findExistingRound(db, companyId, roundTypeNorm, dateNorm);
  if (!existingRound) {
    queries.insertFundingRound(db, {
      company_id: companyId,
      round_type: result.roundType,
      round_type_normalized: roundTypeNorm,
      amount_usd: result.amountRaw ? parseAmount(result.amountRaw) : null,
      amount_raw: result.amountRaw,
      announced_date: dateNorm,
      investors: result.investors ? JSON.stringify(result.investors) : "[]",
      lead_investors: result.leadInvestors ? JSON.stringify(result.leadInvestors) : "[]",
      source_url: result.sourceUrl,
      source: sourceName,
    });
    return isNewCompany ? "new" : "updated";
  }

  return isNewCompany ? "new" : "skipped";
}

// ─── CLI Entry Point ────────────────────────────────────────────

if (import.meta.main) {
  console.log(`\n🚀 AI Funding Scraper started at ${new Date().toISOString()}\n`);

  try {
    const result = await runScrape();
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}
