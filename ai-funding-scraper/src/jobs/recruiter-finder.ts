/**
 * Recruiter Finder
 *
 * Discovers talent/recruiting contacts at companies that have sales job openings.
 *
 * Strategy:
 * 1. Enrich missing company domains via Exa search
 * 2. Search Exa for LinkedIn profiles of recruiters at each company
 * 3. Scrape company team/about pages for recruiting contacts
 * 4. Guess email addresses from recruiter name + company domain
 */

import Exa from "exa-js";
import { getDb, closeDb } from "../db";
import * as queries from "../db/queries";
import { fetchWithRetry } from "../lib/fetch-helpers";
import { parse as parseHTML } from "node-html-parser";
import { enrichPerson, enrichPeopleBulk, isApolloConfigured } from "../lib/apollo";

const EXA_API_KEY = process.env.EXA_API_KEY || "";

// ─── Types ───────────────────────────────────────────────────────

interface FoundRecruiter {
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: string;
  confidence: "high" | "medium" | "low";
}

// ─── Phase 1: Domain Enrichment ──────────────────────────────────

/** Known company -> domain mappings for major AI companies */
const KNOWN_DOMAINS: Record<string, string> = {
  "anthropic": "anthropic.com",
  "runway": "runwayml.com",
  "synthesia": "synthesia.io",
  "deepgram": "deepgram.com",
  "polyai": "poly.ai",
  "eight sleep": "eightsleep.com",
  "baseten": "baseten.co",
  "gather ai": "gather.ai",
  "apptronik": "apptronik.com",
  "guidde": "guidde.com",
  "gumloop": "gumloop.com",
  "matx": "matx.com",
  "rogo": "rogo.ai",
  "trm labs": "trmlabs.com",
  "torq": "torq.io",
  "lovable": "lovable.dev",
  "render": "render.com",
  "adaptive security": "adaptive.security",
  "flux": "flux.ai",
  "opaque systems": "opaque.co",
  "xai": "x.ai",
  "armorcode": "armorcode.com",
  "chai discovery": "chaidiscovery.com",
  "flex": "flex.com",
  "overland ai": "overland.ai",
  "moonshot ai": "moonshotai.com",
  "neural concept": "neuralconcept.com",
  "fiddler ai": "fiddler.ai",
  "cogent security": "cogentsecurity.ai",
  "depthfirst": "depthfirst.ai",
  "hypercore": "hypercore.ai",
  "lio": "lio.io",
  "alaffia health": "alaffia.com",
  "articul8": "articul8.ai",
  "bretton ai": "bretton.ai",
  "mia labs": "mialabs.io",
  "risa labs": "risalabs.com",
  "noda ai": "noda.ai",
  "gruve": "gruve.ai",
  "legora": "legora.ai",
  "sage": "sage.com",
  "levitate": "levitate.ai",
  "scanner": "scanner.dev",
  "kai": "kai.ai",
  "fundamental": "fundamental.ai",
  "nevis": "nevis.ai",
  "quince": "quince.com",
  "valerie health": "valeriehealth.com",
  "wonderful": "wonderful.ai",
  "protege": "protege.ai",
  "didero": "didero.com",
  "matia": "matia.ai",
  "flora": "flora.ai",
  "hook": "hook.ai",
  "take2": "take2.co",
  "stacks": "stacks.co",
  "listen labs": "listenlabs.ai",
  "fulcrum": "fulcrum.ai",
  "astelia": "astelia.ai",
};

export async function enrichCompanyDomains(): Promise<number> {
  const db = getDb();
  let enriched = 0;

  // Get companies missing domains
  const noDomain = db.prepare(`
    SELECT id, name, normalized_name FROM companies
    WHERE (domain IS NULL OR domain = '') AND is_ai_native = 1
  `).all() as queries.Company[];

  console.log(`  [domain-enrich] ${noDomain.length} companies missing domains`);

  // First pass: use known domains
  for (const company of noDomain) {
    const known = KNOWN_DOMAINS[company.name.toLowerCase()] ||
                  KNOWN_DOMAINS[company.normalized_name];
    if (known) {
      db.prepare("UPDATE companies SET domain = $domain, website = $website, updated_at = datetime('now') WHERE id = $id")
        .run({ $id: company.id, $domain: known, $website: `https://${known}` });
      enriched++;
    }
  }

  console.log(`  [domain-enrich] Set ${enriched} domains from known mappings`);

  // Second pass: Exa search for remaining
  if (EXA_API_KEY) {
    const stillMissing = db.prepare(`
      SELECT id, name FROM companies
      WHERE (domain IS NULL OR domain = '') AND is_ai_native = 1
    `).all() as queries.Company[];

    if (stillMissing.length > 0) {
      console.log(`  [domain-enrich] Searching Exa for ${stillMissing.length} remaining...`);
      const exa = new Exa(EXA_API_KEY);

      // Batch by 5 to save API calls
      for (let i = 0; i < stillMissing.length; i += 5) {
        const batch = stillMissing.slice(i, i + 5);
        for (const company of batch) {
          try {
            const response = await exa.search(`${company.name} official website AI startup`, {
              type: "auto",
              numResults: 3,
              category: "company",
            });

            for (const result of response.results) {
              if (!result.url) continue;
              try {
                const url = new URL(result.url);
                const domain = url.hostname.replace("www.", "");

                // Skip generic sites
                if (["linkedin.com", "crunchbase.com", "twitter.com", "x.com",
                     "github.com", "techcrunch.com", "bloomberg.com", "wikipedia.org",
                     "ycombinator.com", "medium.com", "substack.com"].some(d => domain.includes(d))) {
                  continue;
                }

                // Looks like a company domain
                db.prepare("UPDATE companies SET domain = $domain, website = $website, updated_at = datetime('now') WHERE id = $id")
                  .run({ $id: company.id, $domain: domain, $website: `https://${domain}` });
                enriched++;
                break;
              } catch {}
            }

            await Bun.sleep(100);
          } catch {
            // Skip
          }
        }
      }
    }
  }

  console.log(`  [domain-enrich] Total domains enriched: ${enriched}`);
  return enriched;
}

// ─── Phase 2: Exa LinkedIn Search ────────────────────────────────

const RECRUITER_TITLE_KEYWORDS = [
  "recruiter",
  "talent acquisition",
  "talent partner",
  "people operations",
  "head of people",
  "head of talent",
  "hr manager",
  "vp people",
  "director of talent",
  "people partner",
  "hiring manager",
  "recruiting manager",
  "talent lead",
  "sourcer",
];

export async function findRecruitersViaExa(
  companies: queries.Company[]
): Promise<Map<number, FoundRecruiter[]>> {
  if (!EXA_API_KEY) {
    console.warn("  [recruiter-exa] No EXA_API_KEY set");
    return new Map();
  }

  const exa = new Exa(EXA_API_KEY);
  const results = new Map<number, FoundRecruiter[]>();

  // Strategy 1: Batch search for "company recruiter linkedin"
  console.log(`  [recruiter-exa] Searching for recruiters at ${companies.length} companies...`);

  for (let i = 0; i < companies.length; i += 3) {
    const batch = companies.slice(i, i + 3);
    const companyNames = batch.map(c => `"${c.name}"`).join(" OR ");

    try {
      const response = await exa.searchAndContents(
        `${companyNames} recruiter talent acquisition linkedin`,
        {
          type: "auto",
          numResults: 15,
          text: { maxCharacters: 1500 },
          category: "linkedin profile",
        }
      );

      for (const result of response.results) {
        const url = result.url || "";
        const title = result.title || "";
        const text = result.text || "";
        const fullText = `${title} ${text}`.toLowerCase();

        // Must be a LinkedIn profile
        const linkedinMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
        if (!linkedinMatch) continue;

        const linkedinUrl = `https://linkedin.com/in/${linkedinMatch[1]}`;

        // Check if this is a recruiting/talent person
        const isRecruiter = RECRUITER_TITLE_KEYWORDS.some(kw => fullText.includes(kw));
        if (!isRecruiter) continue;

        // Extract name from LinkedIn title (usually "FirstName LastName - Title at Company")
        const nameMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
        if (!nameMatch) continue;

        const name = nameMatch[1].trim();

        // Validate name
        if (!isValidPersonName(name)) continue;

        // Extract title from profile
        const recruiterTitle = extractTitleFromLinkedIn(title, text);

        // Match to one of the batch companies
        let matchedCompany: queries.Company | null = null;
        for (const company of batch) {
          const nameLower = company.name.toLowerCase();
          if (fullText.includes(nameLower) ||
              (company.domain && fullText.includes(company.domain))) {
            matchedCompany = company;
            break;
          }
        }

        // Also try all companies if batch didn't match
        if (!matchedCompany) {
          for (const company of companies) {
            const nameLower = company.name.toLowerCase();
            if (fullText.includes(nameLower) ||
                (company.domain && fullText.includes(company.domain))) {
              matchedCompany = company;
              break;
            }
          }
        }

        if (!matchedCompany) continue;

        const existing = results.get(matchedCompany.id) || [];
        // Avoid duplicates
        if (existing.some(r => r.linkedinUrl === linkedinUrl || r.name === name)) continue;

        existing.push({
          name,
          title: recruiterTitle,
          email: null,
          linkedinUrl,
          source: "exa-linkedin",
          confidence: "high",
        });
        results.set(matchedCompany.id, existing);
      }

      await Bun.sleep(200);
    } catch (err) {
      console.warn(`  [recruiter-exa] Batch search failed:`, (err as Error).message);
    }

    if (i % 30 === 0 && i > 0) {
      console.log(`  [recruiter-exa] Searched ${i}/${companies.length} companies, found ${[...results.values()].flat().length} recruiters...`);
    }
  }

  // Strategy 2: Direct company-specific searches for top-priority companies (those without results)
  const noResults = companies.filter(c => !results.has(c.id)).slice(0, 40);
  if (noResults.length > 0) {
    console.log(`  [recruiter-exa] Direct search for ${noResults.length} companies without results...`);

    for (const company of noResults) {
      try {
        const response = await exa.searchAndContents(
          `"${company.name}" recruiter hiring talent linkedin.com/in`,
          {
            type: "auto",
            numResults: 5,
            text: { maxCharacters: 1000 },
          }
        );

        for (const result of response.results) {
          const url = result.url || "";
          const title = result.title || "";
          const text = result.text || "";
          const fullText = `${title} ${text}`.toLowerCase();

          const linkedinMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/);
          if (!linkedinMatch) continue;

          const isRecruiter = RECRUITER_TITLE_KEYWORDS.some(kw => fullText.includes(kw));
          if (!isRecruiter) continue;

          const nameMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
          if (!nameMatch) continue;

          const name = nameMatch[1].trim();
          if (!isValidPersonName(name)) continue;

          // Verify this person is associated with the company
          if (!fullText.includes(company.name.toLowerCase()) &&
              !(company.domain && fullText.includes(company.domain))) {
            continue;
          }

          const recruiterTitle = extractTitleFromLinkedIn(title, text);
          const linkedinUrl = `https://linkedin.com/in/${linkedinMatch[1]}`;

          const existing = results.get(company.id) || [];
          if (existing.some(r => r.linkedinUrl === linkedinUrl || r.name === name)) continue;

          existing.push({
            name,
            title: recruiterTitle,
            email: null,
            linkedinUrl,
            source: "exa-linkedin-direct",
            confidence: "high",
          });
          results.set(company.id, existing);
        }

        await Bun.sleep(200);
      } catch {
        // Skip
      }
    }
  }

  return results;
}

// ─── Phase 3: Team Page Scraping ─────────────────────────────────

export async function findRecruitersFromTeamPages(
  companies: queries.Company[]
): Promise<Map<number, FoundRecruiter[]>> {
  const results = new Map<number, FoundRecruiter[]>();

  const withDomain = companies.filter(c => c.domain);
  console.log(`  [team-pages] Checking ${withDomain.length} company websites for team pages...`);

  const teamPaths = ["/about", "/team", "/about-us", "/about/team", "/company", "/company/team"];

  for (const company of withDomain) {
    for (const path of teamPaths) {
      try {
        const url = `https://${company.domain}${path}`;
        const res = await fetchWithRetry(url, { rateLimitMs: 1000, maxRetries: 1 });
        if (!res.ok) continue;

        const html = await res.text();
        if (html.length < 200) continue;

        const root = parseHTML(html);
        const text = root.text;
        const textLower = text.toLowerCase();

        // Look for recruiting/talent people mentioned with their titles
        for (const keyword of RECRUITER_TITLE_KEYWORDS) {
          // Find the keyword in text
          let searchStart = 0;
          while (true) {
            const idx = textLower.indexOf(keyword, searchStart);
            if (idx === -1) break;
            searchStart = idx + keyword.length;

            // Look for a name near this keyword (within 100 chars before/after)
            const context = text.substring(Math.max(0, idx - 100), idx + keyword.length + 100);
            const namePattern = /([A-Z][a-z]{1,15} [A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)/g;
            let nameMatch;
            while ((nameMatch = namePattern.exec(context)) !== null) {
              const name = nameMatch[1].trim();
              if (!isValidPersonName(name)) continue;

              const existing = results.get(company.id) || [];
              if (existing.some(r => r.name === name)) continue;

              existing.push({
                name,
                title: keyword.charAt(0).toUpperCase() + keyword.slice(1),
                email: null,
                linkedinUrl: null,
                source: "team-page",
                confidence: "medium",
              });
              results.set(company.id, existing);
            }
          }
        }

        // Also look for LinkedIn URLs paired with recruiting titles
        const linkedinPattern = /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/g;
        let linkedinMatch;
        while ((linkedinMatch = linkedinPattern.exec(html)) !== null) {
          const linkedinUrl = `https://linkedin.com/in/${linkedinMatch[1]}`;
          const surroundingText = html.substring(
            Math.max(0, linkedinMatch.index - 200),
            linkedinMatch.index + 200
          ).toLowerCase();

          const isRecruiter = RECRUITER_TITLE_KEYWORDS.some(kw => surroundingText.includes(kw));
          if (!isRecruiter) continue;

          const plainSurrounding = parseHTML(html.substring(
            Math.max(0, linkedinMatch.index - 200),
            linkedinMatch.index + 200
          )).text;
          const nameMatch = plainSurrounding.match(/([A-Z][a-z]{1,15} [A-Z][a-z]{1,15})/);
          if (!nameMatch || !isValidPersonName(nameMatch[1])) continue;

          const existing = results.get(company.id) || [];
          if (existing.some(r => r.linkedinUrl === linkedinUrl)) continue;

          existing.push({
            name: nameMatch[1],
            title: null,
            email: null,
            linkedinUrl,
            source: "team-page",
            confidence: "medium",
          });
          results.set(company.id, existing);
        }

        if (results.has(company.id)) break; // Found recruiters, skip other paths
      } catch {
        // Skip
      }
    }
  }

  return results;
}

// ─── Phase 4: Email Pattern Guessing ─────────────────────────────

const EMAIL_PATTERNS = [
  // Most common patterns in tech/startup companies
  (first: string, last: string, domain: string) => `${first}@${domain}`,
  (first: string, last: string, domain: string) => `${first}.${last}@${domain}`,
  (first: string, last: string, domain: string) => `${first[0]}${last}@${domain}`,
  (first: string, last: string, domain: string) => `${first}${last[0]}@${domain}`,
  (first: string, last: string, domain: string) => `${first}${last}@${domain}`,
];

export function guessEmails(
  recruiterName: string,
  companyDomain: string
): { email: string; pattern: string }[] {
  const parts = recruiterName.toLowerCase().split(/\s+/);
  if (parts.length < 2) return [];

  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");

  if (!first || !last) return [];

  return [
    { email: `${first}@${companyDomain}`, pattern: "first" },
    { email: `${first}.${last}@${companyDomain}`, pattern: "first.last" },
    { email: `${first[0]}${last}@${companyDomain}`, pattern: "flast" },
    { email: `${first}${last[0]}@${companyDomain}`, pattern: "firstl" },
    { email: `${first}${last}@${companyDomain}`, pattern: "firstlast" },
  ];
}

/** Pick the most likely email pattern for a given domain */
export function bestGuessEmail(recruiterName: string, companyDomain: string): string | null {
  const guesses = guessEmails(recruiterName, companyDomain);
  if (guesses.length === 0) return null;

  // Most tech startups use first.last@ or first@
  // Prioritize first.last@ as the most common
  return guesses.find(g => g.pattern === "first.last")?.email || guesses[0].email;
}

// ─── Helpers ─────────────────────────────────────────────────────

function isValidPersonName(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;

  const invalidWords = new Set([
    "the", "and", "for", "with", "from", "this", "that", "your", "our", "their",
    "digital", "channel", "sales", "about", "more", "than", "have", "been", "will", "not",
    "shortages", "worsen", "partners", "advertising", "company", "senior", "junior", "lead",
    "remote", "hybrid", "based", "open", "apply", "view", "read", "join", "explore",
    "page", "home", "blog", "news", "team", "work", "meet", "here", "find", "next",
    "top", "best", "new", "all", "get", "see", "how", "why", "what", "who",
    "head", "director", "manager", "engineer", "analyst", "specialist", "coordinator",
    "sign", "login", "register", "submit", "click", "learn",
    "series", "round", "funding", "raises", "million", "billion",
  ]);

  return words.every(w =>
    w.length >= 2 &&
    w.length <= 15 &&
    /^[A-Z][a-z]+$/.test(w) &&
    !invalidWords.has(w.toLowerCase())
  );
}

function extractTitleFromLinkedIn(profileTitle: string, profileText: string): string | null {
  // LinkedIn titles usually: "Name - Title at Company | LinkedIn"
  const titleMatch = profileTitle.match(/\s*[-\u2013\u2014]\s*(.+?)(?:\s*(?:at|@)\s|\s*\|)/i);
  if (titleMatch) {
    const candidate = titleMatch[1].trim();
    if (RECRUITER_TITLE_KEYWORDS.some(kw => candidate.toLowerCase().includes(kw))) {
      return candidate;
    }
  }

  // Try extracting from text
  for (const keyword of RECRUITER_TITLE_KEYWORDS) {
    if (profileText.toLowerCase().includes(keyword)) {
      return keyword.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  return null;
}

// ─── Main Orchestrator ───────────────────────────────────────────

export async function runRecruiterFinder(): Promise<{
  domainsEnriched: number;
  recruitersFound: number;
  companiesCovered: number;
  emailsGuessed: number;
}> {
  const db = getDb();

  const summary = {
    domainsEnriched: 0,
    recruitersFound: 0,
    companiesCovered: 0,
    emailsGuessed: 0,
  };

  console.log("\n===================================================");
  console.log("  Recruiter Finder -- Discovering talent contacts");
  console.log("===================================================\n");

  // ─── Phase 1: Enrich company domains ─────────────────────
  console.log("[Phase 1] Enriching company domains...");
  summary.domainsEnriched = await enrichCompanyDomains();
  console.log();

  // ─── Get target companies ────────────────────────────────
  const companiesNeedingRecruiters = queries.getCompaniesWithSalesJobsNeedingRecruiters(db);
  console.log(`[Target] ${companiesNeedingRecruiters.length} companies with sales jobs need recruiter discovery\n`);

  if (companiesNeedingRecruiters.length === 0) {
    console.log("All companies already have recruiters. Done!");
    return summary;
  }

  // ─── Phase 2: Exa LinkedIn search ─────────────────────────
  console.log("[Phase 2] Searching Exa for recruiters via LinkedIn...");
  const exaRecruiters = await findRecruitersViaExa(companiesNeedingRecruiters);

  let exaCount = 0;
  for (const [companyId, recruiters] of exaRecruiters) {
    for (const r of recruiters) {
      // Get the company for email guessing
      const company = companiesNeedingRecruiters.find(c => c.id === companyId);
      let email = r.email;
      let emailGuessed = 0;

      if (!email && company?.domain && r.name) {
        email = bestGuessEmail(r.name, company.domain);
        emailGuessed = email ? 1 : 0;
        if (emailGuessed) summary.emailsGuessed++;
      }

      queries.insertCompanyRecruiter(db, {
        company_id: companyId,
        name: r.name,
        title: r.title,
        email,
        email_guessed: emailGuessed,
        linkedin_url: r.linkedinUrl,
        source: r.source,
        confidence: r.confidence,
      });
      exaCount++;
    }
  }

  console.log(`  Found ${exaCount} recruiters via Exa LinkedIn search\n`);
  summary.recruitersFound += exaCount;

  // ─── Phase 3: Team page scraping ───────────────────────────
  // Only for companies that still don't have recruiters
  const stillNeeding = companiesNeedingRecruiters.filter(c => !exaRecruiters.has(c.id));
  if (stillNeeding.length > 0) {
    console.log(`[Phase 3] Scraping team pages for ${stillNeeding.length} remaining companies...`);
    const teamRecruiters = await findRecruitersFromTeamPages(stillNeeding);

    let teamCount = 0;
    for (const [companyId, recruiters] of teamRecruiters) {
      for (const r of recruiters) {
        const company = stillNeeding.find(c => c.id === companyId);
        let email = r.email;
        let emailGuessed = 0;

        if (!email && company?.domain && r.name) {
          email = bestGuessEmail(r.name, company.domain);
          emailGuessed = email ? 1 : 0;
          if (emailGuessed) summary.emailsGuessed++;
        }

        queries.insertCompanyRecruiter(db, {
          company_id: companyId,
          name: r.name,
          title: r.title,
          email,
          email_guessed: emailGuessed,
          linkedin_url: r.linkedinUrl,
          source: r.source,
          confidence: r.confidence,
        });
        teamCount++;
      }
    }

    console.log(`  Found ${teamCount} recruiters from team pages\n`);
    summary.recruitersFound += teamCount;
  }

  // ─── Phase 4: Verify emails via Apollo.io, fallback to guessing ─────
  // Include recruiters without email AND those with only guessed emails
  const recruitersNeedingVerification = db.prepare(`
    SELECT cr.*, c.domain, c.name as company_name FROM company_recruiters cr
    JOIN companies c ON c.id = cr.company_id
    WHERE c.domain IS NOT NULL AND (cr.email IS NULL OR (cr.email_guessed = 1 AND cr.email_verified = 0))
  `).all() as (queries.CompanyRecruiter & { domain: string; company_name: string })[];

  if (isApolloConfigured()) {
    console.log(`[Phase 4] Enriching ${recruitersNeedingVerification.length} recruiters via Apollo.io...`);
    let apolloVerified = 0;
    let apolloFailed = 0;

    // Process in batches of 10 (Apollo bulk limit)
    for (let i = 0; i < recruitersNeedingVerification.length; i += 10) {
      const batch = recruitersNeedingVerification.slice(i, i + 10);

      const results = await enrichPeopleBulk(
        batch.map((r) => {
          const nameParts = r.name.split(/\s+/);
          return {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(" "),
            domain: r.domain,
            organizationName: r.company_name,
            linkedinUrl: r.linkedin_url || undefined,
          };
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const match = results[j];

        if (match?.email) {
          const verified = match.emailStatus === "verified" ? 1 : 0;
          db.prepare(`
            UPDATE company_recruiters SET
              email = $email,
              email_guessed = 0,
              email_verified = $verified,
              email_source = 'apollo',
              title = COALESCE($title, title),
              linkedin_url = COALESCE($linkedin, linkedin_url),
              phone = COALESCE($phone, phone),
              updated_at = datetime('now')
            WHERE id = $id
          `).run({
            $id: r.id,
            $email: match.email,
            $verified: verified,
            $title: match.title,
            $linkedin: match.linkedinUrl,
            $phone: match.phone,
          });
          apolloVerified++;
          summary.emailsGuessed++; // count for total summary
        } else {
          apolloFailed++;
        }
      }

      if (i % 50 === 0 && i > 0) {
        console.log(`  [apollo] Progress: ${i}/${recruitersNeedingVerification.length} (${apolloVerified} verified, ${apolloFailed} not found)`);
      }
    }

    console.log(`  [apollo] Verified ${apolloVerified} emails, ${apolloFailed} not found in Apollo\n`);

    // Fallback: guess emails for those Apollo couldn't find
    const stillMissingEmail = db.prepare(`
      SELECT cr.*, c.domain FROM company_recruiters cr
      JOIN companies c ON c.id = cr.company_id
      WHERE cr.email IS NULL AND c.domain IS NOT NULL
    `).all() as (queries.CompanyRecruiter & { domain: string })[];

    if (stillMissingEmail.length > 0) {
      console.log(`  [fallback] Guessing emails for ${stillMissingEmail.length} remaining recruiters...`);
      let guessed = 0;
      for (const r of stillMissingEmail) {
        const email = bestGuessEmail(r.name, r.domain);
        if (email) {
          db.prepare(`
            UPDATE company_recruiters SET
              email = $email, email_guessed = 1, email_verified = 0, email_source = 'guess',
              updated_at = datetime('now')
            WHERE id = $id
          `).run({ $id: r.id, $email: email });
          guessed++;
        }
      }
      console.log(`  [fallback] Guessed ${guessed} emails\n`);
      summary.emailsGuessed += guessed;
    }
  } else {
    console.log(`[Phase 4] No APOLLO_API_KEY set, guessing emails for ${recruitersNeedingVerification.length} recruiters...`);
    let emailsGuessed = 0;
    for (const r of recruitersNeedingVerification) {
      const email = bestGuessEmail(r.name, r.domain);
      if (email) {
        db.prepare(`
          UPDATE company_recruiters SET
            email = $email, email_guessed = 1, email_verified = 0, email_source = 'guess',
            updated_at = datetime('now')
          WHERE id = $id
        `).run({ $id: r.id, $email: email });
        emailsGuessed++;
      }
    }
    console.log(`  Guessed ${emailsGuessed} emails (set APOLLO_API_KEY to verify)\n`);
    summary.emailsGuessed += emailsGuessed;
  }

  // ─── Also link recruiters to job openings ──────────────────
  console.log("[Phase 5] Linking recruiters to sales job openings...");
  const allRecruiters = db.prepare(`
    SELECT cr.company_id, cr.name, cr.title, cr.email, cr.linkedin_url
    FROM company_recruiters cr
    ORDER BY cr.confidence DESC
  `).all() as queries.CompanyRecruiter[];

  // Group by company
  const recruitersByCompany = new Map<number, queries.CompanyRecruiter[]>();
  for (const r of allRecruiters) {
    const existing = recruitersByCompany.get(r.company_id) || [];
    existing.push(r);
    recruitersByCompany.set(r.company_id, existing);
  }

  let linkedJobs = 0;
  for (const [companyId, recruiters] of recruitersByCompany) {
    if (recruiters.length === 0) continue;
    const primary = recruiters[0]; // Best confidence

    // Update all sales jobs for this company that don't have recruiter info
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

  console.log(`  Linked recruiters to ${linkedJobs} sales job openings\n`);

  // ─── Summary ───────────────────────────────────────────────
  const stats = queries.getRecruiterStats(db);
  summary.companiesCovered = stats.companies_with_recruiters;

  console.log("===================================================");
  console.log("  Recruiter Finder Complete!");
  console.log(`  Domains enriched: ${summary.domainsEnriched}`);
  console.log(`  Recruiters found: ${summary.recruitersFound}`);
  console.log(`  Companies covered: ${summary.companiesCovered}`);
  console.log(`  Emails processed: ${summary.emailsGuessed}`);
  console.log("---------------------------------------------------");
  console.log(`  Total recruiters in DB: ${stats.total_recruiters}`);
  console.log(`  With email: ${stats.recruiters_with_email}`);
  console.log(`    Verified (Apollo): ${stats.recruiters_with_verified_email}`);
  console.log(`    Guessed (pattern): ${stats.recruiters_with_guessed_email}`);
  console.log(`  With LinkedIn: ${stats.recruiters_with_linkedin}`);
  console.log("===================================================\n");

  return summary;
}

// ─── CLI Entry Point ─────────────────────────────────────────────

if (import.meta.main) {
  console.log(`\nRecruiter Finder started at ${new Date().toISOString()}\n`);

  try {
    const result = await runRecruiterFinder();
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    closeDb();
  }
}
