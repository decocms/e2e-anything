/**
 * Exa.ai Job Search
 *
 * Uses Exa's semantic search to find sales job postings at AI companies.
 * Much more efficient than checking each company individually —
 * a single Exa query returns jobs across many companies at once.
 *
 * Strategy:
 * - ~15 targeted queries for "AI startup sales hiring"
 * - Match results back to companies in our database
 * - Extract recruiter info from the job posting text
 */

import Exa from "exa-js";
import { isSalesRole, classifyDepartment, extractRecruiterInfo } from "./sales-classifier";
import type { Company } from "../db/queries";

const EXA_API_KEY = process.env.EXA_API_KEY || "";

export interface ExaJobResult {
  companyName: string;
  matchedCompanyId: number | null;
  title: string;
  department: string | null;
  location: string | null;
  url: string;
  descriptionSnippet: string | null;
  isSales: boolean;
  recruiterName: string | null;
  recruiterTitle: string | null;
  recruiterEmail: string | null;
  recruiterLinkedin: string | null;
  postedDate: string | null;
  source: string;
}

// Targeted search queries for finding sales jobs at AI startups
const SALES_JOB_QUERIES = [
  // Direct sales job searches
  "AI startup account executive job opening 2026",
  "AI company sales hiring SDR BDR 2026",
  "artificial intelligence startup sales representative job",
  "AI startup business development representative hiring",
  "AI company enterprise sales job opening",
  "generative AI startup sales team hiring",
  "AI startup head of sales VP sales hiring",
  "machine learning company sales engineer job opening",
  "AI startup account manager customer success hiring",
  "AI startup go-to-market GTM sales job",

  // ATS-specific queries to find career pages
  "AI startup careers sales jobs greenhouse lever",
  "AI company sales openings apply now 2026",
  "AI startup hiring sales team remote",
  "AI startup solutions engineer pre-sales hiring",
  "AI company channel sales partnerships hiring",
];

export async function searchExaForSalesJobs(
  companies: Company[]
): Promise<ExaJobResult[]> {
  if (!EXA_API_KEY) {
    console.warn("  [exa-jobs] No EXA_API_KEY set — skipping Exa job search");
    return [];
  }

  const exa = new Exa(EXA_API_KEY);
  const results: ExaJobResult[] = [];
  const seenUrls = new Set<string>();

  // Build a lookup map for matching results to companies
  const companyNameMap = new Map<string, Company>();
  for (const company of companies) {
    companyNameMap.set(company.name.toLowerCase(), company);
    companyNameMap.set(company.normalized_name, company);
    if (company.domain) {
      companyNameMap.set(company.domain.toLowerCase(), company);
    }
  }

  let totalArticles = 0;
  let totalJobs = 0;

  for (const query of SALES_JOB_QUERIES) {
    try {
      const response = await exa.searchAndContents(query, {
        type: "auto",
        numResults: 50,
        category: "company",  // Focus on company/career pages
        text: { maxCharacters: 3000 },
        highlights: {
          numSentences: 3,
          query: "sales account executive SDR BDR hiring recruiter",
        },
      });

      totalArticles += response.results.length;

      for (const result of response.results) {
        if (seenUrls.has(result.url || "")) continue;
        seenUrls.add(result.url || "");

        const title = result.title || "";
        const text = result.text || "";
        const highlights = (result.highlights || []).join(" ");
        const fullText = `${title} ${text} ${highlights}`;

        // Check if this is actually a sales job
        if (!isSalesRole(title, text)) continue;

        // Try to match to a company in our DB
        const matchedCompany = matchToCompany(result, companies, companyNameMap);

        // Extract recruiter info
        const recruiter = extractRecruiterInfo(fullText);

        // Extract location from text
        const location = extractLocation(text);

        results.push({
          companyName: extractCompanyFromJobPosting(result, title, text),
          matchedCompanyId: matchedCompany?.id ?? null,
          title: cleanJobTitle(title),
          department: classifyDepartment(title),
          location,
          url: result.url || "",
          descriptionSnippet: (highlights || text.slice(0, 500)).replace(/\s+/g, " ").trim(),
          isSales: true,
          recruiterName: recruiter.name,
          recruiterTitle: recruiter.title,
          recruiterEmail: recruiter.email,
          recruiterLinkedin: recruiter.linkedin,
          postedDate: result.publishedDate?.split("T")[0] || null,
          source: "exa-jobs",
        });

        totalJobs++;
      }

      // Small delay between queries
      await Bun.sleep(200);
    } catch (err) {
      console.warn(`  [exa-jobs] Query failed: "${query.slice(0, 50)}...":`, (err as Error).message);
    }
  }

  console.log(`  [exa-jobs] Scanned ${totalArticles} pages, found ${totalJobs} sales jobs`);

  return results;
}

// ─── Also search by company name for the most important companies ──

export async function searchExaForCompanyJobs(
  companies: Company[],
  maxCompanies: number = 50
): Promise<ExaJobResult[]> {
  if (!EXA_API_KEY) return [];

  const exa = new Exa(EXA_API_KEY);
  const results: ExaJobResult[] = [];
  const seenUrls = new Set<string>();

  // Sort companies by most recent funding to prioritize
  const toCheck = companies.slice(0, maxCompanies);

  // Batch companies into groups of 5 for combined queries
  for (let i = 0; i < toCheck.length; i += 5) {
    const batch = toCheck.slice(i, i + 5);
    const companyNames = batch.map(c => c.name).join(" OR ");
    const query = `${companyNames} sales hiring job opening careers`;

    try {
      const response = await exa.searchAndContents(query, {
        type: "auto",
        numResults: 20,
        text: { maxCharacters: 2000 },
        highlights: {
          numSentences: 2,
          query: "sales account executive hiring recruiter apply",
        },
      });

      for (const result of response.results) {
        if (seenUrls.has(result.url || "")) continue;
        seenUrls.add(result.url || "");

        const title = result.title || "";
        const text = result.text || "";

        if (!isSalesRole(title, text)) continue;

        // Match to one of the batch companies
        let matchedCompany: Company | null = null;
        for (const company of batch) {
          const lower = (text + " " + title + " " + (result.url || "")).toLowerCase();
          if (
            lower.includes(company.name.toLowerCase()) ||
            (company.domain && lower.includes(company.domain))
          ) {
            matchedCompany = company;
            break;
          }
        }

        const recruiter = extractRecruiterInfo(`${title} ${text}`);

        results.push({
          companyName: matchedCompany?.name || extractCompanyFromJobPosting(result, title, text),
          matchedCompanyId: matchedCompany?.id ?? null,
          title: cleanJobTitle(title),
          department: classifyDepartment(title),
          location: extractLocation(text),
          url: result.url || "",
          descriptionSnippet: text.slice(0, 500).replace(/\s+/g, " ").trim(),
          isSales: true,
          recruiterName: recruiter.name,
          recruiterTitle: recruiter.title,
          recruiterEmail: recruiter.email,
          recruiterLinkedin: recruiter.linkedin,
          postedDate: result.publishedDate?.split("T")[0] || null,
          source: "exa-jobs",
        });
      }

      await Bun.sleep(200);
    } catch {
      // Skip failed batch
    }
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────

function matchToCompany(
  result: any,
  companies: Company[],
  nameMap: Map<string, Company>
): Company | null {
  const url = (result.url || "").toLowerCase();
  const title = (result.title || "").toLowerCase();
  const text = (result.text || "").toLowerCase().slice(0, 500);

  // Try domain matching from URL
  try {
    const domain = new URL(url).hostname.replace("www.", "").replace("jobs.", "").replace("careers.", "");
    const domainBase = domain.split(".")[0];
    const match = nameMap.get(domain) || nameMap.get(domainBase);
    if (match) return match;
  } catch {}

  // Try name matching in title and text
  for (const company of companies) {
    const nameLower = company.name.toLowerCase();
    if (nameLower.length < 3) continue;

    if (title.includes(nameLower) || text.includes(nameLower) || url.includes(nameLower.replace(/\s+/g, ""))) {
      return company;
    }
  }

  return null;
}

function extractCompanyFromJobPosting(result: any, title: string, text: string): string {
  // Try to get company from URL (for ATS platforms)
  const url = result.url || "";

  // Greenhouse: boards.greenhouse.io/{company}
  const ghMatch = url.match(/boards\.greenhouse\.io\/([^/]+)/);
  if (ghMatch) return ghMatch[1].replace(/-/g, " ");

  // Lever: jobs.lever.co/{company}
  const leverMatch = url.match(/jobs\.lever\.co\/([^/]+)/);
  if (leverMatch) return leverMatch[1].replace(/-/g, " ");

  // Ashby: jobs.ashbyhq.com/{company}
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/]+)/);
  if (ashbyMatch) return ashbyMatch[1].replace(/-/g, " ");

  // Workable: apply.workable.com/{company}
  const workableMatch = url.match(/apply\.workable\.com\/([^/]+)/);
  if (workableMatch) return workableMatch[1].replace(/-/g, " ");

  // Try to extract from title "Job Title at CompanyName" or "CompanyName - Job Title"
  const atMatch = title.match(/(?:at|@)\s+([^|–-]+?)(?:\s*[|–-]|$)/i);
  if (atMatch) return atMatch[1].trim();

  const dashMatch = title.match(/^([^|–-]+?)\s*[|–-]\s/);
  if (dashMatch) {
    const candidate = dashMatch[1].trim();
    if (!isSalesRole(candidate)) return candidate;
  }

  // Use the hostname as last resort
  try {
    return new URL(url).hostname.replace("www.", "").split(".")[0];
  } catch {
    return "Unknown";
  }
}

function cleanJobTitle(title: string): string {
  // Remove company name prefixes/suffixes commonly in page titles
  return title
    .replace(/\s*[|–-]\s*.*$/, "")  // Remove "| Company" suffix
    .replace(/^.*[|–-]\s*/, "")      // Remove "Company |" prefix if it leaves a job title
    .replace(/\s*\(.*?\)\s*$/, "")   // Remove trailing (location) etc.
    .trim();
}

function extractLocation(text: string): string | null {
  // Common location patterns in job postings
  const patterns = [
    /(?:location|based in|office in|located in)[:\s]+([A-Z][a-zA-Z\s,]+(?:USA|US|UK|CA|DE|FR|IL|IN|Remote)?)/i,
    /(?:remote|hybrid|on-site|onsite)\s*(?:[,/]\s*)?(?:in\s+)?([A-Z][a-zA-Z\s,]+)?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text.slice(0, 1000));
    if (match && match[1] && match[1].trim().length > 2) {
      return match[1].trim().slice(0, 100);
    }
    if (match && !match[1]) {
      // Just "Remote" etc.
      return match[0].trim().slice(0, 50);
    }
  }

  // Check for "Remote" explicitly
  if (/\bremote\b/i.test(text.slice(0, 500))) {
    return "Remote";
  }

  return null;
}
