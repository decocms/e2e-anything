/**
 * Apollo Recruiter Search
 *
 * Replaces the Exa LinkedIn search with Apollo's People Search API
 * to find recruiters at AI-native companies by exact domain matching.
 *
 * Phases:
 *   0. Clean up domain-mismatched recruiters
 *   1. Identify target companies needing recruiters
 *   2. Apollo People Search (by company domain + recruiter titles)
 *   3. Apollo Email Enrichment (bulk)
 *   4. Domain-validate, insert, and link to jobs
 *
 * Usage:
 *   bun src/jobs/apollo-recruiter-search.ts [--dry-run] [--skip-cleanup] [--limit N]
 */

import { getDb, closeDb } from "../db";
import * as queries from "../db/queries";
import {
  searchPeopleAtDomain,
  enrichById,
  isApolloConfigured,
  type ApolloSearchResult,
} from "../lib/apollo";
import { bestGuessEmail } from "./recruiter-finder";

// ─── Config ─────────────────────────────────────────────────────

const RECRUITER_TITLES = [
  "recruiter",
  "talent acquisition",
  "talent partner",
  "head of people",
  "head of talent",
  "vp people",
  "director of talent",
  "people operations",
  "hiring manager",
  "recruiting manager",
  "talent lead",
  "sourcer",
  "hr manager",
  "people partner",
];

interface SearchCandidate {
  companyId: number;
  companyDomain: string;
  companyName: string;
  apolloId: string;
  firstName: string | null;
  title: string | null;
}

// ─── Phase 0: Cleanup ───────────────────────────────────────────

function cleanMismatchedRecruiters(db: ReturnType<typeof getDb>, dryRun: boolean): number {
  const mismatched = db.prepare(`
    SELECT cr.id, cr.name, cr.email, c.name as company, c.domain
    FROM company_recruiters cr
    JOIN companies c ON c.id = cr.company_id
    WHERE cr.email IS NOT NULL
      AND c.domain IS NOT NULL
      AND c.domain != ''
      AND LOWER(SUBSTR(cr.email, INSTR(cr.email, '@') + 1)) != LOWER(c.domain)
  `).all() as { id: number; name: string; email: string; company: string; domain: string }[];

  if (mismatched.length === 0) {
    console.log("  No mismatched recruiters found.");
    return 0;
  }

  console.log(`  Found ${mismatched.length} domain-mismatched recruiters:`);
  for (const r of mismatched.slice(0, 10)) {
    console.log(`    ${r.name} <${r.email}> at ${r.company} (${r.domain})`);
  }
  if (mismatched.length > 10) {
    console.log(`    ... and ${mismatched.length - 10} more`);
  }

  if (dryRun) {
    console.log("  [dry-run] Would delete these recruiters.");
    return mismatched.length;
  }

  const ids = mismatched.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(
    `DELETE FROM company_recruiters WHERE id IN (${placeholders})`
  ).run(...ids);

  console.log(`  Deleted ${result.changes} mismatched recruiters.`);
  return result.changes;
}

// ─── Phase 1: Target Companies ──────────────────────────────────

// Domains that are news/media sites, not real company websites
const INVALID_DOMAINS = new Set([
  "globenewswire.com", "prnewswire.com", "play.google.com", "businesswire.com",
  "linkedin.com", "crunchbase.com", "twitter.com", "x.com", "github.com",
  "techcrunch.com", "bloomberg.com", "wikipedia.org", "medium.com", "substack.com",
  "ycombinator.com", "google.com", "youtube.com", "apple.com", "amazon.com",
  "fortune.com", "reuters.com", "wsj.com", "nytimes.com", "cnbc.com",
  "ainewsroundup.com", "startup.ai",
]);

function isValidCompanyName(name: string): boolean {
  // Skip article-fragment names from the scraper
  if (name.length > 40) return false;
  if (name.startsWith(",") || name.startsWith("-") || name.startsWith(":")) return false;
  // Names starting with "AI " followed by common article words
  if (/^AI\s+(Drug|Firm|Lab|News|Shopping|vs|security|Fintech|Vets|native)/i.test(name)) return false;
  return true;
}

function getTargetCompanies(db: ReturnType<typeof getDb>): queries.Company[] {
  const all = db.prepare(`
    SELECT DISTINCT c.* FROM companies c
    WHERE c.is_ai_native = 1
      AND c.domain IS NOT NULL
      AND c.domain != ''
      AND LENGTH(c.name) >= 2
      AND c.id NOT IN (
        SELECT cr.company_id FROM company_recruiters cr
        JOIN companies c2 ON c2.id = cr.company_id
        WHERE cr.email IS NOT NULL
          AND c2.domain IS NOT NULL
          AND LOWER(SUBSTR(cr.email, INSTR(cr.email, '@') + 1)) = LOWER(c2.domain)
      )
    ORDER BY c.name
  `).all() as queries.Company[];

  return all.filter((c) =>
    c.domain &&
    !INVALID_DOMAINS.has(c.domain.toLowerCase()) &&
    isValidCompanyName(c.name)
  );
}

// ─── Phase 2-4: Search, Enrich, Insert ──────────────────────────

function emailMatchesDomain(email: string | null, companyDomain: string): boolean {
  if (!email) return false;
  const emailDomain = email.split("@")[1]?.toLowerCase();
  return emailDomain === companyDomain.toLowerCase();
}

async function processCompanies(
  db: ReturnType<typeof getDb>,
  companies: queries.Company[],
  dryRun: boolean,
): Promise<{ searched: number; candidatesFound: number; inserted: number; emailsVerified: number }> {
  const stats = { searched: 0, candidatesFound: 0, inserted: 0, emailsVerified: 0 };

  // Phase 2: Search for recruiter candidates at each company
  console.log(`\n[Phase 2] Searching Apollo for recruiters at ${companies.length} companies...`);
  const allCandidates: SearchCandidate[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (!company.domain) continue;

    try {
      const results = await searchPeopleAtDomain({
        domain: company.domain,
        titles: RECRUITER_TITLES,
        perPage: 25,
      });

      for (const r of results) {
        if (!r.apolloId || !r.firstName) continue;

        allCandidates.push({
          companyId: company.id,
          companyDomain: company.domain,
          companyName: company.name,
          apolloId: r.apolloId,
          firstName: r.firstName,
          title: r.title,
        });
      }

      stats.searched++;

      if ((i + 1) % 20 === 0) {
        console.log(`  Progress: ${i + 1}/${companies.length} companies searched, ${allCandidates.length} candidates found`);
      }
    } catch (err) {
      console.warn(`  [search] Failed for ${company.name}: ${(err as Error).message}`);
    }
  }

  stats.candidatesFound = allCandidates.length;
  console.log(`  Search complete: ${allCandidates.length} candidates found at ${stats.searched} companies`);

  if (allCandidates.length === 0) {
    console.log("  No candidates to enrich.");
    return stats;
  }

  if (dryRun) {
    console.log("\n[Phase 3] [dry-run] Would enrich and insert these candidates:");
    const byCompany = new Map<string, SearchCandidate[]>();
    for (const c of allCandidates) {
      const list = byCompany.get(c.companyName) || [];
      list.push(c);
      byCompany.set(c.companyName, list);
    }
    for (const [company, candidates] of byCompany) {
      console.log(`  ${company} (${candidates[0].companyDomain}):`);
      for (const c of candidates) {
        console.log(`    - ${c.firstName} | ${c.title || "no title"} | id:${c.apolloId}`);
      }
    }
    return stats;
  }

  // Phase 3: Enrich each candidate by Apollo ID to get full name + email
  console.log(`\n[Phase 3] Enriching ${allCandidates.length} candidates by Apollo ID...`);

  for (let i = 0; i < allCandidates.length; i++) {
    const candidate = allCandidates[i];
    const match = await enrichById(candidate.apolloId);

    if (!match) {
      // Skip candidates we can't enrich
      continue;
    }

    const fullName = [match.firstName, match.lastName].filter(Boolean).join(" ");
    if (!fullName || fullName.length < 3) continue;

    let email: string | null = null;
    let emailVerified = 0;
    let emailGuessed = 0;
    let emailSource = "apollo";

    if (match.email && emailMatchesDomain(match.email, candidate.companyDomain)) {
      email = match.email;
      emailVerified = match.emailStatus === "verified" ? 1 : 0;
      if (emailVerified) stats.emailsVerified++;
    } else {
      // No matching email from Apollo — guess from full name
      email = bestGuessEmail(fullName, candidate.companyDomain);
      emailGuessed = email ? 1 : 0;
      emailSource = "guess";
    }

    queries.insertCompanyRecruiter(db, {
      company_id: candidate.companyId,
      name: fullName,
      title: match.title || candidate.title,
      email,
      email_guessed: emailGuessed,
      email_verified: emailVerified,
      email_source: emailSource,
      linkedin_url: match.linkedinUrl,
      phone: match.phone,
      source: "apollo-search",
      confidence: emailVerified ? "high" : emailGuessed ? "medium" : "low",
    });
    stats.inserted++;

    if ((i + 1) % 20 === 0) {
      console.log(`  Enrichment progress: ${i + 1}/${allCandidates.length} (${stats.inserted} inserted, ${stats.emailsVerified} verified)`);
    }
  }

  console.log(`  Enriched and inserted ${stats.inserted} recruiters (${stats.emailsVerified} verified emails)`);

  // Link recruiters to sales job openings
  console.log("\n[Phase 4b] Linking recruiters to sales job openings...");
  const allRecruiters = db.prepare(`
    SELECT cr.company_id, cr.name, cr.title, cr.email, cr.linkedin_url
    FROM company_recruiters cr
    ORDER BY cr.email_verified DESC, cr.confidence DESC
  `).all() as queries.CompanyRecruiter[];

  const recruitersByCompany = new Map<number, queries.CompanyRecruiter[]>();
  for (const r of allRecruiters) {
    const existing = recruitersByCompany.get(r.company_id) || [];
    existing.push(r);
    recruitersByCompany.set(r.company_id, existing);
  }

  let linkedJobs = 0;
  for (const [companyId, recruiters] of recruitersByCompany) {
    if (recruiters.length === 0) continue;
    const primary = recruiters[0];

    const result = db.prepare(`
      UPDATE job_openings SET
        recruiter_name = $name,
        recruiter_title = $title,
        recruiter_email = $email,
        recruiter_linkedin = $linkedin,
        updated_at = datetime('now')
      WHERE company_id = $company_id
        AND is_sales = 1
        AND recruiter_name IS NULL
    `).run({
      $company_id: companyId,
      $name: primary.name,
      $title: primary.title,
      $email: primary.email,
      $linkedin: primary.linkedin_url,
    });
    linkedJobs += result.changes;
  }

  if (linkedJobs > 0) {
    console.log(`  Linked recruiters to ${linkedJobs} sales job openings`);
  }

  return stats;
}

// ─── Main ───────────────────────────────────────────────────────

export async function runApolloRecruiterSearch(opts: {
  dryRun?: boolean;
  skipCleanup?: boolean;
  limit?: number;
} = {}): Promise<{
  cleaned: number;
  targetCompanies: number;
  searched: number;
  candidatesFound: number;
  inserted: number;
  emailsVerified: number;
}> {
  if (!isApolloConfigured()) {
    console.error("APOLLO_API_KEY is not set. Set it in your .env file.");
    process.exit(1);
  }

  const db = getDb();
  const summary = {
    cleaned: 0,
    targetCompanies: 0,
    searched: 0,
    candidatesFound: 0,
    inserted: 0,
    emailsVerified: 0,
  };

  console.log("\n===================================================");
  console.log("  Apollo Recruiter Search");
  console.log(`  Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}${opts.limit ? ` | Limit: ${opts.limit}` : ""}`);
  console.log("===================================================\n");

  // Phase 0: Cleanup
  if (!opts.skipCleanup) {
    console.log("[Phase 0] Cleaning domain-mismatched recruiters...");
    summary.cleaned = cleanMismatchedRecruiters(db, !!opts.dryRun);
    console.log();
  }

  // Phase 1: Find target companies
  console.log("[Phase 1] Identifying target companies...");
  let targets = getTargetCompanies(db);
  summary.targetCompanies = targets.length;
  console.log(`  ${targets.length} companies need domain-matched recruiters`);

  if (opts.limit && opts.limit < targets.length) {
    targets = targets.slice(0, opts.limit);
    console.log(`  Limited to first ${opts.limit} companies`);
  }

  if (targets.length === 0) {
    console.log("\n  All companies already have domain-matched recruiters. Done!");
    return summary;
  }

  // Phases 2-4: Search, enrich, insert
  const result = await processCompanies(db, targets, !!opts.dryRun);
  Object.assign(summary, result);

  // Summary
  const stats = queries.getRecruiterStats(db);
  console.log("\n===================================================");
  console.log("  Apollo Recruiter Search Complete!");
  console.log("---------------------------------------------------");
  console.log(`  Cleaned:          ${summary.cleaned} mismatched`);
  console.log(`  Targets:          ${summary.targetCompanies} companies`);
  console.log(`  Searched:         ${summary.searched} companies`);
  console.log(`  Candidates:       ${summary.candidatesFound} found`);
  console.log(`  Inserted:         ${summary.inserted} recruiters`);
  console.log(`  Verified emails:  ${summary.emailsVerified}`);
  console.log("---------------------------------------------------");
  console.log(`  Total recruiters: ${stats.total_recruiters}`);
  console.log(`    With email:     ${stats.recruiters_with_email}`);
  console.log(`    Verified:       ${stats.recruiters_with_verified_email}`);
  console.log(`    Guessed:        ${stats.recruiters_with_guessed_email}`);
  console.log(`    With LinkedIn:  ${stats.recruiters_with_linkedin}`);
  console.log(`  Companies covered: ${stats.companies_with_recruiters}`);
  console.log("===================================================\n");

  return summary;
}

// ─── CLI Entry Point ────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipCleanup = args.includes("--skip-cleanup");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined;

  console.log(`\nApollo Recruiter Search started at ${new Date().toISOString()}`);

  try {
    await runApolloRecruiterSearch({ dryRun, skipCleanup, limit });
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}
