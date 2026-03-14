/**
 * ATS Platform Scraper
 *
 * Checks common Applicant Tracking Systems (Greenhouse, Lever, Ashby, Workable)
 * for job listings at each company. These platforms have predictable URL patterns
 * and often expose job data as JSON or structured HTML.
 */

import { fetchWithRetry } from "../lib/fetch-helpers";
import { parse as parseHTML } from "node-html-parser";
import { isSalesRole, classifyDepartment, extractRecruiterInfo } from "./sales-classifier";

export interface ScrapedJob {
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
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

// ─── Common ATS slug generators ──────────────────────────────────

function generateSlugs(companyName: string, domain: string | null): string[] {
  const slugs: string[] = [];

  // From company name
  const nameLower = companyName.toLowerCase();
  // Remove common suffixes
  const cleaned = nameLower
    .replace(/\s*(inc\.?|llc|ltd\.?|co\.?|corp\.?|laboratories|technologies|tech)\s*$/gi, "")
    .trim();

  // Generate slug variations
  const dashSlug = cleaned.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const noSpaceSlug = cleaned.replace(/[^a-z0-9]/g, "");

  if (dashSlug.length >= 2) slugs.push(dashSlug);
  if (noSpaceSlug.length >= 2 && noSpaceSlug !== dashSlug) slugs.push(noSpaceSlug);

  // From domain
  if (domain) {
    const domainSlug = domain.split(".")[0].toLowerCase();
    if (domainSlug.length >= 2 && !slugs.includes(domainSlug)) {
      slugs.push(domainSlug);
    }
  }

  return slugs.slice(0, 3); // Max 3 slugs to try
}

// ─── Greenhouse Scraper ──────────────────────────────────────────

async function scrapeGreenhouse(slug: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Greenhouse has a JSON API
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    const res = await fetchWithRetry(url, { rateLimitMs: 500, maxRetries: 1 });
    if (!res.ok) return jobs;

    const data = await res.json() as { jobs?: any[] };
    if (!data.jobs) return jobs;

    for (const job of data.jobs) {
      const title = job.title || "";
      const desc = (job.content || "").replace(/<[^>]+>/g, " ").slice(0, 1000);
      const sales = isSalesRole(title, desc);

      jobs.push({
        title,
        department: sales ? classifyDepartment(title) : (job.departments?.[0]?.name || null),
        location: job.location?.name || null,
        employmentType: null,
        url: job.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${job.id}`,
        descriptionSnippet: desc.slice(0, 500) || null,
        isSales: sales,
        recruiterName: null,
        recruiterTitle: null,
        recruiterEmail: null,
        recruiterLinkedin: null,
        postedDate: job.updated_at?.split("T")[0] || null,
        source: "greenhouse",
      });
    }
  } catch {
    // Slug doesn't exist on Greenhouse
  }

  return jobs;
}

// ─── Lever Scraper ───────────────────────────────────────────────

async function scrapeLever(slug: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Lever has a JSON API
    const url = `https://api.lever.co/v0/postings/${slug}`;
    const res = await fetchWithRetry(url, { rateLimitMs: 500, maxRetries: 1 });
    if (!res.ok) return jobs;

    const data = await res.json() as any[];
    if (!Array.isArray(data)) return jobs;

    for (const job of data) {
      const title = job.text || "";
      const desc = (job.descriptionPlain || job.description || "").slice(0, 1000);
      const sales = isSalesRole(title, desc);

      // Lever sometimes includes hiring manager in additionalPlain
      const recruiter = extractRecruiterInfo(
        (job.additionalPlain || "") + " " + (job.additional || "")
      );

      jobs.push({
        title,
        department: sales ? classifyDepartment(title) : (job.categories?.department || null),
        location: job.categories?.location || null,
        employmentType: job.categories?.commitment || null,
        url: job.hostedUrl || `https://jobs.lever.co/${slug}/${job.id}`,
        descriptionSnippet: desc.slice(0, 500) || null,
        isSales: sales,
        recruiterName: recruiter.name,
        recruiterTitle: recruiter.title,
        recruiterEmail: recruiter.email,
        recruiterLinkedin: recruiter.linkedin,
        postedDate: job.createdAt ? new Date(job.createdAt).toISOString().split("T")[0] : null,
        source: "lever",
      });
    }
  } catch {
    // Slug doesn't exist on Lever
  }

  return jobs;
}

// ─── Ashby Scraper ───────────────────────────────────────────────

async function scrapeAshby(slug: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Ashby has a JSON API endpoint
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    const res = await fetchWithRetry(url, { rateLimitMs: 500, maxRetries: 1 });
    if (!res.ok) return jobs;

    const data = await res.json() as { jobs?: any[] };
    if (!data.jobs) return jobs;

    for (const job of data.jobs) {
      const title = job.title || "";
      const desc = (job.descriptionPlain || "").slice(0, 1000);
      const sales = isSalesRole(title, desc);

      jobs.push({
        title,
        department: sales ? classifyDepartment(title) : (job.departmentName || null),
        location: job.locationName || (job.isRemote ? "Remote" : null),
        employmentType: job.employmentType || null,
        url: job.jobUrl || `https://jobs.ashbyhq.com/${slug}/${job.id}`,
        descriptionSnippet: desc.slice(0, 500) || null,
        isSales: sales,
        recruiterName: null,
        recruiterTitle: null,
        recruiterEmail: null,
        recruiterLinkedin: null,
        postedDate: job.publishedDate?.split("T")[0] || null,
        source: "ashby",
      });
    }
  } catch {
    // Slug doesn't exist on Ashby
  }

  return jobs;
}

// ─── Workable Scraper ────────────────────────────────────────────

async function scrapeWorkable(slug: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Workable careers page
    const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs`;
    const res = await fetchWithRetry(url, {
      rateLimitMs: 500,
      maxRetries: 1,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [] }),
    });
    if (!res.ok) return jobs;

    const data = await res.json() as { results?: any[] };
    if (!data.results) return jobs;

    for (const job of data.results) {
      const title = job.title || "";
      const sales = isSalesRole(title, job.department || "");

      jobs.push({
        title,
        department: sales ? classifyDepartment(title) : (job.department || null),
        location: [job.city, job.state, job.country].filter(Boolean).join(", ") || null,
        employmentType: job.type || null,
        url: job.url || `https://apply.workable.com/${slug}/j/${job.shortcode}`,
        descriptionSnippet: null,
        isSales: sales,
        recruiterName: null,
        recruiterTitle: null,
        recruiterEmail: null,
        recruiterLinkedin: null,
        postedDate: job.published ? new Date(job.published).toISOString().split("T")[0] : null,
        source: "workable",
      });
    }
  } catch {
    // Slug doesn't exist on Workable
  }

  return jobs;
}

// ─── Career Page Scraper ─────────────────────────────────────────

async function scrapeCareerPage(companyDomain: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  // Common career page paths
  const careerPaths = [
    "/careers",
    "/jobs",
    "/careers/open-positions",
    "/company/careers",
    "/join-us",
    "/about/careers",
    "/work-with-us",
  ];

  for (const path of careerPaths) {
    try {
      const url = `https://${companyDomain}${path}`;
      const res = await fetchWithRetry(url, { rateLimitMs: 1000, maxRetries: 1 });
      if (!res.ok) continue;

      const html = await res.text();
      if (html.length < 500) continue;

      const root = parseHTML(html);

      // Check if this page redirects to an ATS
      const atsRedirects = html.match(
        /(?:boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com)\/([a-z0-9-]+)/i
      );
      if (atsRedirects) {
        // We'll catch this through the ATS scrapers
        break;
      }

      // Look for job listings in the HTML
      const jobElements = root.querySelectorAll(
        '[class*="job"], [class*="position"], [class*="opening"], [class*="career"], [data-job], li a[href*="job"], li a[href*="career"], li a[href*="position"]'
      );

      for (const el of jobElements) {
        const title = el.text?.trim();
        if (!title || title.length < 5 || title.length > 200) continue;

        const link = el.querySelector("a")?.getAttribute("href") || el.getAttribute("href") || "";
        let jobUrl = link;
        if (link && !link.startsWith("http")) {
          jobUrl = `https://${companyDomain}${link.startsWith("/") ? "" : "/"}${link}`;
        }

        if (!jobUrl || jobUrl === `https://${companyDomain}`) continue;

        const sales = isSalesRole(title);
        if (sales) {
          jobs.push({
            title,
            department: classifyDepartment(title),
            location: null,
            employmentType: null,
            url: jobUrl,
            descriptionSnippet: null,
            isSales: true,
            recruiterName: null,
            recruiterTitle: null,
            recruiterEmail: null,
            recruiterLinkedin: null,
            postedDate: null,
            source: "career-page",
          });
        }
      }

      if (jobs.length > 0) break; // Found jobs, no need to try more paths
    } catch {
      // Skip this path
    }
  }

  return jobs;
}

// ─── Main ATS Scraper Function ───────────────────────────────────

export async function scrapeATSPlatforms(
  companyName: string,
  domain: string | null
): Promise<ScrapedJob[]> {
  const slugs = generateSlugs(companyName, domain);
  const allJobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();

  // Try each ATS platform with each slug (in parallel per platform)
  for (const slug of slugs) {
    const results = await Promise.allSettled([
      scrapeGreenhouse(slug),
      scrapeLever(slug),
      scrapeAshby(slug),
      scrapeWorkable(slug),
    ]);

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const job of result.value) {
          if (!seenUrls.has(job.url)) {
            seenUrls.add(job.url);
            allJobs.push(job);
          }
        }
      }
    }

    // If we found jobs with this slug, no need to try others
    if (allJobs.length > 0) break;
  }

  // Also try scraping the company's own career page
  if (domain) {
    try {
      const careerJobs = await scrapeCareerPage(domain);
      for (const job of careerJobs) {
        if (!seenUrls.has(job.url)) {
          seenUrls.add(job.url);
          allJobs.push(job);
        }
      }
    } catch {
      // Skip
    }
  }

  return allJobs;
}

/**
 * For sales jobs, try to fetch the individual job page and extract recruiter info
 */
export async function enrichJobWithRecruiter(job: ScrapedJob): Promise<ScrapedJob> {
  if (!job.isSales || !job.url) return job;
  if (job.recruiterName || job.recruiterEmail) return job; // Already have info

  try {
    const res = await fetchWithRetry(job.url, { rateLimitMs: 1000, maxRetries: 1 });
    if (!res.ok) return job;

    const html = await res.text();
    const recruiter = extractRecruiterInfo(html);

    return {
      ...job,
      recruiterName: recruiter.name || job.recruiterName,
      recruiterTitle: recruiter.title || job.recruiterTitle,
      recruiterEmail: recruiter.email || job.recruiterEmail,
      recruiterLinkedin: recruiter.linkedin || job.recruiterLinkedin,
    };
  } catch {
    return job;
  }
}
